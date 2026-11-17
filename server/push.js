import { subscriptionTransaction, recordSubscriptionAdded } from './subscription-history.js';
import { endpointWhere, endpointParams } from './storage-maintenance.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { selectPublicDomains, publicDomain } from './domain-configuration.js';
import { createSecurity } from './security.js';
import { requestLocation, mergeLocation, requestVisitorIp } from './audience.js';
import { locationReceipt } from './subscriber-location.js';
import { requestDevice, requestBrowser, deviceCountSql, summarizeDevices } from './subscriber-device.js';
import { parsePushAudience, pushAudienceWhere } from './push-audience.js';
import { validPushEndpoint, prepareNotification, deliverNotification } from './notification-delivery.js';
export { validPushEndpoint } from './notification-delivery.js';
import { recordPromptSubscription } from './subscription-prompts.js';
import { readTargeting, requestTarget, targetAllowed } from './targeting.js';

const publicDir = fileURLToPath(new URL('../client/public/', import.meta.url));
const equal = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const hostMatches = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

export function installPush(app, { pool, webpush, secret, publicApiBase, vapidSubject, accounts, reporting, browser }) {
  const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const senderKey = (key) => sign(`send:${key}`);
  const security = createSecurity({accounts,pool,secret,browser});
  const {createToken,requireAdmin,authenticate:isAdmin}=security;
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
      return res.json({ ok: true, data: { ...publicDomain(rows[0]), api_base: apiBase, service_url: `${apiBase}/api/notifications`, sender_api_key: req.auth.role==='admin'?senderKey(req.params.key):null, live_ready: liveReady } });
    } catch (error) {
      console.error('Integration configuration failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load integration settings. Check the database connection.' });
    }
  });

  app.post('/api/subscriptions', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { domain_key: domainKey, subscription } = req.body || {};
    const keys = subscription?.keys;
    if (typeof domainKey !== 'string' || !validPushEndpoint(subscription?.endpoint) ||
      !/^[A-Za-z0-9_-]+$/.test(keys?.p256dh || '') || Buffer.from(keys.p256dh, 'base64url').length !== 65 ||
      !/^[A-Za-z0-9_-]+$/.test(keys?.auth || '') || Buffer.from(keys.auth, 'base64url').length !== 16) {
      return res.status(400).json({ ok: false, message: 'A valid browser push subscription and domain key are required.' });
    }
    try {
      const [domains] = await pool.query('SELECT user_id, domain_name, targeting_policy FROM domains WHERE domain_key = ? LIMIT 1', [domainKey]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      let origin;
      try { origin = new URL(req.get('Origin')); } catch { /* Missing/invalid origins are rejected below. */ }
      if (!origin || !hostMatches(origin.hostname, domains[0].domain_name) ||
        (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
        return res.status(403).json({ ok: false, message: 'This website does not match the registered domain.' });
      }
      const profile = requestTarget(req, req.body?.client_context);
      if (!targetAllowed(readTargeting(domains[0].targeting_policy), profile)) return res.status(403).json({ ok: false, message: 'Notifications are not enabled for this device and browser.' });
      const response = await subscriptionTransaction(pool,async connection=>{
      const [existing] = await connection.query(`SELECT id, domain_key, country_code, region_name, region_code, city_name, p256dh, auth, latitude, longitude, location_consent_at FROM subscriptions WHERE ${endpointWhere(pool)} LIMIT 1${pool.notizoLifecycle?' FOR UPDATE':''}`, endpointParams(pool,subscription.endpoint));
      if (existing.length && existing[0].domain_key !== domainKey) {
        throw Object.assign(new Error('This browser subscription belongs to a different domain.'),{status:409});
      }
      if (existing.length && (!equal(existing[0].p256dh, keys.p256dh) || !equal(existing[0].auth, keys.auth))) {
        throw Object.assign(new Error('Existing subscription credentials do not match this browser.'),{status:409});
      }
      const location = mergeLocation(existing[0], requestLocation(req));
      const device = requestDevice(req);
      const browser = requestBrowser(req);
      const ip = requestVisitorIp(req);
      if (existing.length) {
        await connection.query('UPDATE subscriptions SET p256dh = ?, auth = ?, country_code = ?, region_name = ?, region_code = ?, city_name = ?, device_type = COALESCE(?, device_type), browser_family = COALESCE(?, browser_family), target_device = ?, target_browser = ?, ip_address = COALESCE(?, ip_address), ip_recorded_at = CASE WHEN ? IS NULL THEN ip_recorded_at ELSE UTC_TIMESTAMP(3) END, last_seen_at = UTC_TIMESTAMP(3) WHERE id = ? AND domain_key = ?', [keys.p256dh, keys.auth, location.country_code, location.region_name, location.region_code, location.city_name, device, browser, profile.device, profile.browser, ip, ip, existing[0].id, domainKey]);
      if(pool.notizoLifecycle)await connection.query('UPDATE subscription_events SET device_type=COALESCE(?,device_type),browser_family=COALESCE(?,browser_family) WHERE event_key=?',[device,browser,`subscribe:${existing[0].id}`]);
      } else {
        const [inserted] = await connection.query(
          'INSERT INTO subscriptions (user_id, domain_key, endpoint, p256dh, auth, country_code, region_name, region_code, city_name, device_type, browser_family, target_device, target_browser, ip_address, ip_recorded_at, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(3) END, UTC_TIMESTAMP(3), NOW())',
          [domains[0].user_id, domainKey, subscription.endpoint, keys.p256dh, keys.auth, location.country_code, location.region_name, location.region_code, location.city_name, device, browser, profile.device, profile.browser, ip, ip],
        );
        await recordSubscriptionAdded(pool,connection,{id:inserted.insertId,domain_key:domainKey,user_id:domains[0].user_id,device_type:device,browser_family:browser});
        if (req.body?.prompt_token) {
          try { await recordPromptSubscription(connection, secret, req.body.prompt_token, domainKey, inserted.insertId); }
          catch (error) { console.error('Prompt conversion tracking failed:', error.code || 'storage'); }
        }
      }
      return { ok: true, created: !existing.length,
        location_token: locationReceipt(secret, domainKey, subscription.endpoint),
        location_shared: Boolean(existing[0]?.location_consent_at && existing[0]?.latitude != null && existing[0]?.longitude != null),
      };
      });
      return res.json(response);
    } catch (error) {
      if(error.status===409)return res.status(409).json({ok:false,message:error.message});
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, message: 'Subscription conflict. Please try enabling notifications again.' });
      console.error('Subscription storage failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not save the subscription.' });
    }
  });

  app.get('/api/domains/:key/send-audience', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const query = { ...req.query };
    for (const field of ['devices', 'browsers']) if (typeof query[field] === 'string' && query[field] !== 'all') {
      try { query[field] = JSON.parse(query[field]); } catch { return res.status(400).json({ ok: false, message: 'Choose valid device and browser filters.' }); }
    }
    const audience = parsePushAudience(query);
    if (!audience) return res.status(400).json({ ok: false, message: 'Choose a supported platform and subscription period.' });
    try {
      const [domains] = await pool.query('SELECT domain_key, targeting_policy FROM domains WHERE domain_key = ? AND user_id = 1 LIMIT 1', [req.params.key]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const where = pushAudienceWhere(req.params.key, audience, false, readTargeting(domains[0].targeting_policy));
      const [[counts]] = await pool.query(`SELECT COUNT(*) AS subscribers, ${deviceCountSql} FROM subscriptions WHERE ${where.sql}`, where.params);
      const devices = summarizeDevices(counts);
      return res.json({ ok: true, data: { domain_key: req.params.key, platform: audience.platform, subscribed: audience.subscribed,
        matching: audience.platform === 'all' ? Number(counts.subscribers) : Number(counts[audience.platform] || 0),
        total: Number(counts.subscribers), device_unknown: devices.device_unknown, targeting: readTargeting(domains[0].targeting_policy), time_zone: 'UTC' } });
    } catch (error) {
      console.error('Send audience lookup failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load the selected audience.' });
    }
  });

  app.post(['/api/notifications', '/api/notifications/compose'], async (req, res) => {
    const { domain_key: domainKey, title, body = '', url, icon = '' } = req.body || {};
    const senderAuthorized = typeof domainKey === 'string' && equal(req.get('X-Api-Key'), senderKey(domainKey));
    let authorized = senderAuthorized;
    if (!authorized) {
      try { authorized = await isAdmin(req); }
      catch { return res.status(503).json({ ok: false, message: 'Sign in is temporarily unavailable.' }); }
    }
    if (typeof domainKey !== 'string' || !authorized) {
      return res.status(401).json({ ok: false, message: 'Valid sender credentials are required.' });
    }
    if (!senderAuthorized) {
      req.auditDomain=domainKey;
      try{await security.auditMutation(req);}catch{return res.status(503).json({ok:false,message:'Could not record this action. Nothing was sent.'});}
      if (!security.domainAllowed(req,domainKey,true)) return res.status(403).json({ok:false,message:'Your account cannot send to this website.'});
    }
    if (typeof title !== 'string' || !title.trim() || title.length > 150 || typeof body !== 'string' || body.length > 1000 || typeof icon !== 'string') {
      return res.status(400).json({ ok: false, message: 'Provide a title (up to 150 characters) and body (up to 1000 characters).' });
    }
    // A separate composer URL fails closed against older API deployments that
    // would ignore audience filters on the legacy notification endpoint.
    if (req.path.endsWith('/compose') && (!Object.hasOwn(req.body?.audience || {}, 'platform') || !Object.hasOwn(req.body?.audience || {}, 'subscribed'))) {
      return res.status(400).json({ ok: false, message: 'Choose the audience platform and subscription period.' });
    }
    const audience = parsePushAudience(req.body?.audience);
    if (!audience) return res.status(400).json({ ok: false, message: 'Choose a supported platform and subscription period.' });
    try {
      const [domains] = await pool.query('SELECT domain_name, vapid_public_key, vapid_private_key, targeting_policy FROM domains WHERE domain_key = ? AND user_id = 1 LIMIT 1', [domainKey]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const domain = domains[0];
      const prepared = prepareNotification(req.body, domain);
      const source = req.path.endsWith('/compose') ? 'composer' : senderAuthorized ? req.get('X-Push-Source') === 'wordpress' ? 'wordpress' : 'api' : 'test';
      const result = await deliverNotification({ pool, webpush, vapidSubject, reporting }, domain, domainKey, prepared, { source, isTest: source === 'test' || req.body?.is_test === true });
      return res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      if ([400, 409].includes(error.status)) return res.status(error.status).json({ ok: false, message: error.message });
      console.error('Notification send failed:', error.code || error.message);
      return res.status(500).json({ ok: false, message: 'Could not send the notification. Check the database and VAPID configuration.' });
    }
  });
  return { requireAdmin, createToken, security };
}
