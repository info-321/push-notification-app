import crypto from 'node:crypto';
import { requestTarget, targetAllowed, readTargeting } from './targeting.js';

const fingerprint = endpoint => crypto.createHash('sha256').update(endpoint).digest('base64url');
const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(`subscriber-location:${payload}`).digest('base64url');
export function locationReceipt(secret, key, endpoint, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ key, sub: fingerprint(endpoint), exp: now + 30 * 60000 })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}
export function validLocationReceipt(secret, token, key, endpoint, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600 || typeof endpoint !== 'string') return false;
  const [payload, signature, extra] = token.split('.');
  if (extra || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(secret, payload)))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url'));
    return data.key === key && data.sub === fingerprint(endpoint) && Number.isSafeInteger(data.exp) && data.exp > now;
  } catch { return false; }
}
export function validCoordinates(input) {
  return input?.consent === true && Number.isFinite(input.latitude) && Math.abs(input.latitude) <= 90 &&
    Number.isFinite(input.longitude) && Math.abs(input.longitude) <= 180 &&
    Number.isFinite(input.accuracy) && input.accuracy >= 0 && input.accuracy <= 10000000;
}

// A short-lived receipt proves this browser has just saved the matching
// subscription. Domain keys or knowledge of an endpoint alone cannot write GPS.
export function installSubscriberLocation(app, { pool, secret }) {
  app.post('/api/subscriptions/location', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const input = req.body || {}, { domain_key: key, endpoint, token } = input;
    if (!validLocationReceipt(secret, token, key, endpoint)) return res.status(403).json({ ok: false, message: 'Refresh this website before sharing location.' });
    if (!validCoordinates(input)) return res.status(400).json({ ok: false, message: 'Location consent and valid coordinates are required.' });
    try {
      const [domains] = await pool.query('SELECT domain_name, targeting_policy FROM domains WHERE domain_key = ? AND user_id = 1', [key]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Website not found.' });
      let origin;
      try { origin = new URL(req.get('Origin')); } catch { /* Reject missing origins. */ }
      if (!origin || origin.hostname.replace(/^www\./, '') !== domains[0].domain_name.replace(/^www\./, '') ||
        (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) return res.status(403).json({ ok: false, message: 'This website does not match the subscription.' });
      if (!targetAllowed(readTargeting(domains[0].targeting_policy), requestTarget(req, input.client_context))) return res.status(403).json({ ok: false, message: 'Notifications are not enabled for this device and browser.' });
      const [result] = await pool.query(`UPDATE subscriptions SET latitude = ?, longitude = ?, location_accuracy_m = ?,
        location_consent_at = UTC_TIMESTAMP(3), location_recorded_at = UTC_TIMESTAMP(3)
        WHERE domain_key = ? AND endpoint = ? AND user_id = 1`, [input.latitude, input.longitude, input.accuracy, key, endpoint]);
      if (!result.affectedRows) return res.status(404).json({ ok: false, message: 'Subscription not found.' });
      return res.json({ ok: true });
    } catch (error) {
      console.error('Subscriber location storage failed:', error.code);
      return res.status(503).json({ ok: false, message: 'Could not save location. Your notifications are still enabled.' });
    }
  });
}
