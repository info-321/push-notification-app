const day = 86400000;

export function parsePushAudience(value = {}, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['platform', 'subscribed'].includes(key))) return null;
  const { platform = 'all', subscribed = 'all' } = value;
  if (!['all', 'desktop', 'mobile'].includes(platform) || !['all', 'yesterday', '7d', '15d', '30d'].includes(subscribed)) return null;
  let from = null, to = null;
  if (subscribed === 'yesterday') {
    to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()); from = to - day;
  } else if (subscribed !== 'all') { to = now.getTime(); from = to - Number(subscribed.slice(0, -1)) * day; }
  return { platform, subscribed, from, to };
}

export function pushAudienceWhere(domainKey, audience, includePlatform = true) {
  let sql = "domain_key = ? AND user_id = ? AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''";
  const params = [domainKey, 1];
  if (audience.from !== null) { sql += ' AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)'; params.push(audience.from / 1000, audience.to / 1000); }
  if (includePlatform && audience.platform !== 'all') { sql += ' AND device_type = ?'; params.push(audience.platform); }
  return { sql, params };
}
