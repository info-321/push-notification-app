import { BlockList, isIP } from 'node:net';

// Cloudflare's published edge ranges, checked 2026-10-29:
// https://www.cloudflare.com/ips-v4/ and https://www.cloudflare.com/ips-v6/
const cloudflare = new BlockList();
for (const cidr of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']) {
  const [address, prefix] = cidr.split('/');
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
const localProxy = new BlockList();
for (const [address, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16]]) localProxy.addSubnet(address, prefix, 'ipv4');
localProxy.addAddress('::1', 'ipv6');
const normalizeIp = value => typeof value === 'string' ? value.replace(/^::ffff:/, '') : '';
const contains = (list, address) => Boolean(isIP(address) && list.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4'));
const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

export function validCountryCode(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && !['XX', 'ZZ', 'EU', 'UN'].includes(value) && Boolean(regions.of(value));
}

export function requestCountry(req) {
  const country = req.get('CF-IPCountry');
  if (!validCountryCode(country)) return null;
  const peer = normalizeIp(req.socket.remoteAddress);
  if (contains(cloudflare, peer)) return country;
  // The Hostinger API is published on host loopback only. Its local Caddy proxy
  // overwrites X-Forwarded-For with the connecting peer by default. Accept ONLY
  // that single Cloudflare peer, never arbitrary forwarding chains or body data.
  // Do not use this policy behind a proxy that passes untrusted XFF unchanged.
  const forwarded = normalizeIp((req.get('X-Forwarded-For') || '').trim());
  return contains(localProxy, peer) && contains(cloudflare, forwarded) ? country : null;
}

export function installAudience(app, pool) {
  // Inherits the existing /api/domains administrator middleware.
  app.get('/api/domains/:key/audience', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [domains] = await pool.query('SELECT user_id FROM domains WHERE domain_key = ? AND user_id = ?', [req.params.key, 1]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const [rows] = await pool.query(`SELECT country_code, COUNT(*) AS subscribers FROM subscriptions
        WHERE domain_key = ? AND user_id = ? AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''
        GROUP BY country_code`, [req.params.key, domains[0].user_id]);
      const countries = [];
      let unknown = 0;
      for (const row of rows) {
        const subscribers = Number(row.subscribers);
        if (!validCountryCode(row.country_code)) unknown += subscribers;
        else countries.push({ code: row.country_code, name: regions.of(row.country_code), subscribers });
      }
      countries.sort((a, b) => b.subscribers - a.subscribers || a.name.localeCompare(b.name));
      const located = countries.reduce((total, country) => total + country.subscribers, 0);
      return res.json({ ok: true, data: { countries, located, unknown, total: located + unknown, source: 'Cloudflare IP country', capture_available: Boolean(requestCountry(req)) } });
    } catch (error) {
      console.error('Audience lookup failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load audience locations. Please try again.' });
    }
  });
}
