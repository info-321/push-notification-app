import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { selectPublicDomains, publicDomain } from './domain-configuration.js';
import { createAdminToken } from './accounts.js';
import { requestCountry } from './audience.js';

const publicDir = fileURLToPath(new URL('../client/public/', import.meta.url));
const equal = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const hostMatches = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

export function validPushEndpoint(value) {
  try {
    const url = new URL(value);
    const hosts = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (hosts.includes(url.hostname) || url.hostname.endsWith('.notify.windows.com') || url.hostname.endsWith('.push.apple.com'));
  } catch { return false; }
}

export function installPush(app, { pool, webpush, secret, publicApiBase, vapidSubject, accounts }) {
  const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const senderKey = (key) => sign(`send:${key}`);
  const createToken = version => createAdminToken(secret, version);
  const isAdmin = async (req) => {
    let session;
    try {
      const [payload, signature, extra] = (req.get('Authorization') || '').replace(/^Bearer /, '').split('.');
      if (extra || !equal(signature, sign(`session:${payload}`))) return false;
      session = JSON.parse(Buffer.from(payload, 'base64url'));
      if (!Number.isFinite(session.exp) || session.exp <= Date.now()) return false;
    } catch { return false; }
    const account = await accounts.read();
    return Boolean(account && (session.v === account.session_version || (session.v === undefined && !account.password_changed_at)));
  };
  const requireAdmin = async (req, res, next) => {
    try { return await isAdmin(req) ? next() : res.status(401).json({ ok: false, message: 'Please sign in again.' }); }
    catch { return res.status(503).json({ ok: false, message: 'Sign in is temporarily unavailable.' }); }
  };
  const apiBase = publicApiBase.replace(/\/$/, '');
  let liveReady = false;
  try {
    const url = new URL(apiBase);
    liveReady = url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { throw new Error('PUBLIC_API_BASE must be an absolute URL.'); }

  app.use('/sdk', express.static(path.join(publicDir, 'sdk'), { maxAge: 0 }));
  app.get('/push-sw.js', (req, res) => res.sendFile(path.join(publicDir, 'push-sw.js')));
  app.use('/downloads', express.static(path.join(publicDir, 'downloads'), { maxAge: 0 }));

  app.get('/api/domains/:key/integration', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [rows] = await pool.query(`${selectPublicDomains} WHERE d.domain_key = ? AND d.user_id = 1 LIMIT 1`, [req.params.key]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      return res.json({ ok: true, data: { ...publicDomain(rows[0]), api_base: apiBase, service_url: `${apiBase}/api/notifications`, sender_api_key: senderKey(req.params.key), live_ready: liveReady } });
    } catch (error) {
      console.error('Integration configuration failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load integration settings. Check the database connection.' });
    }
  });

  app.post('/api/subscriptions', async (req, res) => {
    const { domain_key: domainKey, subscription } = req.body || {};
    const keys = subscription?.keys;
    if (typeof domainKey !== 'string' || !validPushEndpoint(subscription?.endpoint) ||
      !/^[A-Za-z0-9_-]+$/.test(keys?.p256dh || '') || Buffer.from(keys.p256dh, 'base64url').length !== 65 ||
      !/^[A-Za-z0-9_-]+$/.test(keys?.auth || '') || Buffer.from(keys.auth, 'base64url').length !== 16) {
      return res.status(400).json({ ok: false, message: 'A valid browser push subscription and domain key are required.' });
    }
    try {
      const [domains] = await pool.query('SELECT user_id, domain_name FROM domains WHERE domain_key = ? LIMIT 1', [domainKey]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      let origin;
      try { origin = new URL(req.get('Origin')); } catch { /* Missing/invalid origins are rejected below. */ }
      if (!origin || !hostMatches(origin.hostname, domains[0].domain_name) ||
        (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
        return res.status(403).json({ ok: false, message: 'This website does not match the registered domain.' });
      }
      const [existing] = await pool.query('SELECT id, domain_key FROM subscriptions WHERE endpoint = ? LIMIT 1', [subscription.endpoint]);
      if (existing.length && existing[0].domain_key !== domainKey) {
        return res.status(409).json({ ok: false, message: 'This browser subscription belongs to a different domain.' });
      }
      const country = requestCountry(req);
      if (existing.length) {
        await pool.query('UPDATE subscriptions SET p256dh = ?, auth = ?, country_code = COALESCE(?, country_code) WHERE id = ? AND domain_key = ?', [keys.p256dh, keys.auth, country, existing[0].id, domainKey]);
      } else {
        await pool.query(
          'INSERT INTO subscriptions (user_id, domain_key, endpoint, p256dh, auth, country_code, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [domains[0].user_id, domainKey, subscription.endpoint, keys.p256dh, keys.auth, country],
        );
      }
      return res.json({ ok: true });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, message: 'Subscription conflict. Please try enabling notifications again.' });
      console.error('Subscription storage failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not save the subscription.' });
    }
  });

  app.post('/api/notifications', async (req, res) => {
    const { domain_key: domainKey, title, body = '', url, icon = '' } = req.body || {};
    let authorized = typeof domainKey === 'string' && equal(req.get('X-Api-Key'), senderKey(domainKey));
    if (!authorized) {
      try { authorized = await isAdmin(req); }
      catch { return res.status(503).json({ ok: false, message: 'Sign in is temporarily unavailable.' }); }
    }
    if (typeof domainKey !== 'string' || !authorized) {
      return res.status(401).json({ ok: false, message: 'Valid sender credentials are required.' });
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 150 || typeof body !== 'string' || body.length > 1000 || typeof icon !== 'string') {
      return res.status(400).json({ ok: false, message: 'Provide a title (up to 150 characters) and body (up to 1000 characters).' });
    }
    try {
      const [domains] = await pool.query('SELECT domain_name, vapid_public_key, vapid_private_key FROM domains WHERE domain_key = ? AND user_id = 1 LIMIT 1', [domainKey]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const domain = domains[0];
      let target;
      try { target = new URL(url || '/', `https://${domain.domain_name}`); } catch { /* Reject below. */ }
      if (!target || target.protocol !== 'https:' || !hostMatches(target.hostname, domain.domain_name) || target.username || target.password) {
        return res.status(400).json({ ok: false, message: 'The notification link must use HTTPS on the registered website.' });
      }
      if (icon) {
        try { if (new URL(icon).protocol !== 'https:') throw new Error(); }
        catch { return res.status(400).json({ ok: false, message: 'The icon must be an HTTPS URL.' }); }
      }
      const [subscriptions] = await pool.query('SELECT id, endpoint, p256dh, auth FROM subscriptions WHERE domain_key = ?', [domainKey]);
      const counts = { sent: 0, failed: 0, removed: 0, total: subscriptions.length };
      const payload = JSON.stringify({ title: title.trim(), body, url: target.href, icon });
      // Bound concurrency so a publishing request does not open one connection per subscriber.
      for (let offset = 0; offset < subscriptions.length; offset += 10) {
        await Promise.all(subscriptions.slice(offset, offset + 10).map(async (subscription) => {
          if (!validPushEndpoint(subscription.endpoint)) { counts.failed++; return; }
          try {
            await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, {
              TTL: 3600, timeout: 5000,
              vapidDetails: { subject: vapidSubject, publicKey: domain.vapid_public_key, privateKey: domain.vapid_private_key },
            });
            counts.sent++;
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) {
              await pool.query('DELETE FROM subscriptions WHERE id = ? AND domain_key = ?', [subscription.id, domainKey]);
              counts.removed++;
            } else { counts.failed++; }
          }
        }));
      }
      const message = counts.total === 0 ? 'No subscribers yet. Enable notifications on your website first.' :
        `Accepted by push services: ${counts.sent}. Failed: ${counts.failed}. Expired subscriptions removed: ${counts.removed}.`;
      return res.status(counts.failed && !counts.sent ? 502 : 200).json({ ok: !(counts.failed && !counts.sent), ...counts, message });
    } catch (error) {
      console.error('Notification send failed:', error.code || error.message);
      return res.status(500).json({ ok: false, message: 'Could not send the notification. Check the database and VAPID configuration.' });
    }
  });
  return { requireAdmin, createToken };
}
