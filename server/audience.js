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

export function locationName(value) {
  if (typeof value !== 'string' || value.length > 768) return null;
  // Node's HTTP/1 parser exposes header bytes as Latin-1. Cloudflare sends
  // non-ASCII locations as UTF-8; also accept already-decoded proxy values.
  let text = value;
  if ([...text].every(character => character.codePointAt(0) <= 255)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text, 'latin1')); } catch { /* Already decoded Unicode. */ }
  }
  if (/[\p{Cc}\p{Cf}]/u.test(text)) return null;
  text = text.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!text || [...text].length > 128 || !/\p{L}/u.test(text) || !/^[\p{L}\p{M}\p{N} .,'’()&/+\-]+$/u.test(text) || /^(unknown|null|undefined|none|n\/a)$/i.test(text)) return null;
  return text;
}

export function requestLocation(req) {
  const country_code = requestCountry(req);
  if (!country_code) return { country_code: null, region_name: null, region_code: null, city_name: null };
  const code = req.get('CF-Region-Code');
  return {
    country_code,
    region_name: locationName(req.get('CF-Region')),
    region_code: typeof code === 'string' && /^[a-z0-9-]{1,16}$/i.test(code) ? code.toUpperCase() : null,
    city_name: locationName(req.get('CF-IPCity')),
  };
}

const fold = value => (value || '').normalize('NFC').toLowerCase();
export function mergeLocation(previous, incoming) {
  const stored = Object.fromEntries(['country_code', 'region_name', 'region_code', 'city_name'].map(field => [field, previous?.[field] || null]));
  if (!incoming.country_code) return stored;
  if (stored.country_code !== incoming.country_code) return incoming;
  const stateChanged = Boolean((incoming.region_name || incoming.region_code) && (
    incoming.region_code && stored.region_code ? incoming.region_code !== stored.region_code
      : incoming.region_name && stored.region_name ? fold(incoming.region_name) !== fold(stored.region_name) : true));
  const cityChangedWithoutState = Boolean(incoming.city_name && fold(incoming.city_name) !== fold(stored.city_name) && !incoming.region_name && !incoming.region_code);
  return {
    country_code: incoming.country_code,
    region_name: incoming.region_name || (stateChanged || cityChangedWithoutState ? null : stored.region_name),
    region_code: incoming.region_code || (stateChanged || cityChangedWithoutState ? null : stored.region_code),
    city_name: incoming.city_name || (stateChanged ? null : stored.city_name),
  };
}

export function installAudience(app, pool) {
  // Inherits the existing /api/domains administrator middleware.
  app.get('/api/domains/:key/audience', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [domains] = await pool.query('SELECT user_id FROM domains WHERE domain_key = ? AND user_id = ?', [req.params.key, 1]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const [rows] = await pool.query(`SELECT country_code, region_name, region_code, city_name, COUNT(*) AS subscribers FROM subscriptions
        WHERE domain_key = ? AND user_id = ? AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''
        GROUP BY country_code, region_name, region_code, city_name`, [req.params.key, domains[0].user_id]);
      const countryGroups = new Map(), stateGroups = new Map(), cityGroups = new Map();
      let unknown = 0, stateUnknown = 0, cityUnknown = 0;
      const accumulate = (groups, key, row) => {
        if (groups.has(key)) groups.get(key).subscribers += row.subscribers;
        else groups.set(key, row);
      };
      for (const row of rows) {
        const subscribers = Number(row.subscribers);
        if (!validCountryCode(row.country_code)) { unknown += subscribers; stateUnknown += subscribers; cityUnknown += subscribers; continue; }
        const country = row.country_code, countryName = regions.of(country);
        const stateName = locationName(row.region_name), stateCode = typeof row.region_code === 'string' && /^[A-Z0-9-]{1,16}$/.test(row.region_code) ? row.region_code : null;
        const state = stateName || stateCode, stateKey = stateCode || fold(stateName), city = locationName(row.city_name);
        accumulate(countryGroups, country, { code: country, name: countryName, subscribers });
        if (!state) stateUnknown += subscribers;
        else accumulate(stateGroups, JSON.stringify([country, stateKey]), { name: state, code: stateCode, country_code: country, country_name: countryName, subscribers });
        if (!city) cityUnknown += subscribers;
        else accumulate(cityGroups, JSON.stringify([country, stateKey, fold(city)]), { name: city, region_name: state, region_code: stateCode, country_code: country, country_name: countryName, subscribers });
      }
      const sorted = groups => [...groups.values()].sort((a, b) => b.subscribers - a.subscribers || a.name.localeCompare(b.name) || (a.country_code || '').localeCompare(b.country_code || '') || (a.region_name || '').localeCompare(b.region_name || ''));
      const countries = sorted(countryGroups), states = sorted(stateGroups), cities = sorted(cityGroups);
      const located = countries.reduce((total, country) => total + country.subscribers, 0);
      const captured = requestLocation(req);
      return res.json({ ok: true, data: {
        countries, located, unknown, total: located + unknown, states, cities,
        state_located: states.reduce((total, state) => total + state.subscribers, 0), state_unknown: stateUnknown,
        city_located: cities.reduce((total, city) => total + city.subscribers, 0), city_unknown: cityUnknown,
        source: 'Cloudflare IP geolocation', capture_available: Boolean(captured.country_code),
        capture: { country: Boolean(captured.country_code), state: Boolean(captured.region_name || captured.region_code), city: Boolean(captured.city_name) },
      } });
    } catch (error) {
      console.error('Audience lookup failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load audience locations. Please try again.' });
    }
  });
}
