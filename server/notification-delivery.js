import { parsePushAudience, pushAudienceWhere } from './push-audience.js';
import { normalizeBanner, validImageUrl } from './push-content.js';

export class InvalidNotification extends Error { status = 400; }
export function validPushEndpoint(value) {
  try {
    const url = new URL(value);
    const hosts = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      (hosts.includes(url.hostname) || url.hostname.endsWith('.notify.windows.com') || url.hostname.endsWith('.push.apple.com'));
  } catch { return false; }
}
export function prepareNotification(input, domain, now = new Date()) {
  const { title, body = '', url, icon = '' } = input || {};
  const invalid = message => { throw new InvalidNotification(message); };
  if (typeof title !== 'string' || !title.trim() || title.length > 150 || typeof body !== 'string' || body.length > 1000 || !validImageUrl(icon)) invalid('Provide a title up to 150 characters, a message up to 1000 characters, and an optional public HTTPS icon URL.');
  const audience = parsePushAudience(input.audience, now);
  if (!audience) invalid('Choose a supported platform and subscription period.');
  let target;
  try { target = new URL(url || '/', `https://${domain.domain_name}`); } catch { /* Reject below. */ }
  if (!target || target.protocol !== 'https:' || target.hostname.replace(/^www\./, '') !== domain.domain_name.replace(/^www\./, '') || target.username || target.password || target.port) invalid('The notification link must use HTTPS on the registered website.');
  let banner;
  try { banner = normalizeBanner(input.banner || { enabled: false }, domain.domain_name); }
  catch (error) { invalid(error.message); }
  const page = target.pathname + target.search + target.hash;
  const payload = JSON.stringify({ title: title.trim(), body, url: page, icon,
    ...(banner.enabled ? { image: banner.image, actions: banner.actions.map(action => ({ ...action, url: action.url || page })) } : {}) });
  if (Buffer.byteLength(payload, 'utf8') > 3500) invalid('This notification is too large. Shorten its message, links, or button labels.');
  return { payload, audience, content: { title: title.trim(), body, url: page, icon, banner, audience: { platform: audience.platform, subscribed: audience.subscribed } } };
}

export async function deliverNotification({ pool, webpush, vapidSubject }, domain, domainKey, prepared, { beforeBatch = async () => {}, onProgress = async () => {} } = {}) {
  const where = pushAudienceWhere(domainKey, prepared.audience);
  const [subscriptions] = await pool.query(`SELECT id, endpoint, p256dh, auth FROM subscriptions WHERE ${where.sql}`, where.params);
  const counts = { sent: 0, failed: 0, removed: 0, total: subscriptions.length };
  for (let offset = 0; offset < subscriptions.length; offset += 10) {
    await beforeBatch();
    await Promise.all(subscriptions.slice(offset, offset + 10).map(async subscription => {
      if (!validPushEndpoint(subscription.endpoint)) { counts.failed++; return; }
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, prepared.payload, {
          TTL: 3600, timeout: 5000,
          vapidDetails: { subject: vapidSubject, publicKey: domain.vapid_public_key, privateKey: domain.vapid_private_key },
        });
        counts.sent++;
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          await pool.query('DELETE FROM subscriptions WHERE id = ? AND domain_key = ?', [subscription.id, domainKey]); counts.removed++;
        } else counts.failed++;
      }
    }));
    await onProgress({ ...counts });
  }
  const message = !counts.total ? (prepared.audience.platform !== 'all' || prepared.audience.subscribed !== 'all' ? 'No subscribers match the selected audience.' : 'No subscribers yet. Enable notifications on your website first.') :
    `Accepted by push services: ${counts.sent}. Failed: ${counts.failed}. Expired subscriptions removed: ${counts.removed}.`;
  return { ok: !(counts.failed && !counts.sent), ...counts, message };
}
