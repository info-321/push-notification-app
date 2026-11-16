import { requestBrowser } from './subscriber-device.js';

export const targetDevices = ['windows', 'mac', 'ipad', 'iphone', 'android_phone', 'android_tablet', 'other'];
export const targetBrowsers = ['Chrome', 'Safari', 'Firefox', 'Opera', 'Edge', 'home_screen', 'Other'];
export const validSelection = (value, choices, empty = false) => Array.isArray(value) && (empty || value.length > 0) && value.length <= choices.length && new Set(value).size === value.length && value.every(item => choices.includes(item));
export function normalizeTargeting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['mode', 'devices', 'browsers'].includes(key))) return null;
  if (!['all', 'selected'].includes(value.mode) || !validSelection(value.devices, targetDevices, true) || !validSelection(value.browsers, targetBrowsers, true)) return null;
  return { mode: value.mode, devices: [...value.devices].sort(), browsers: [...value.browsers].sort() };
}
export function readTargeting(value) {
  // Existing websites retain their previous behavior until an administrator saves a rule.
  if (value === null || value === undefined) return { mode: 'all', devices: [], browsers: [], version: 0 };
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  const clean = normalizeTargeting({ mode: data.mode, devices: data.devices, browsers: data.browsers });
  if (!clean || !Number.isSafeInteger(data.version) || data.version < 1) throw new Error('Invalid stored targeting rules');
  return { ...clean, version: data.version };
}
export function requestTarget(req, context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) context = {};
  const agent = req.get('User-Agent');
  if (typeof agent !== 'string' || !agent || agent.length > 2048 || /bot|spider|crawler|curl|wget|undici|python-requests/i.test(agent)) return { device: null, browser: null };
  const ipad = /iPad/i.test(agent) || (/Macintosh/i.test(agent) && context.ipad === true);
  const iphone = /iPhone|iPod/i.test(agent);
  const device = ipad ? 'ipad' : iphone ? 'iphone' : /Windows NT/i.test(agent) ? 'windows' : /Macintosh/i.test(agent) ? 'mac' : /Android/i.test(agent) ? /Mobile/i.test(agent) ? 'android_phone' : 'android_tablet' : /X11|CrOS|Linux|Tablet|Silk\/|Kindle/i.test(agent) ? 'other' : null;
  const family = requestBrowser(req);
  const browser = (ipad || iphone) && context.standalone === true ? 'home_screen' : targetBrowsers.includes(family) ? family : family ? 'Other' : null;
  return { device, browser };
}
export const targetAllowed = (policy, profile) => policy.mode === 'all' || (policy.devices.includes(profile.device) && policy.browsers.includes(profile.browser));
export function addTargetWhere(where, policy, audience = {}) {
  // Separate AND clauses enforce the intersection even for direct API callers.
  const append = (column, values) => {
    if (!values.length) { where.sql += ' AND 1 = 0'; return; }
    where.sql += ` AND ${column} IN (${values.map(() => '?').join(',')})`; where.params.push(...values);
  };
  if (policy.mode !== 'all') { append('target_device', policy.devices); append('target_browser', policy.browsers); }
  if (Array.isArray(audience.devices)) append('target_device', audience.devices);
  if (Array.isArray(audience.browsers)) append('target_browser', audience.browsers);
  return where;
}

export function installTargeting(app, { pool, requireAdmin }) {
  app.get('/api/targeting/:key', async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.vary('Origin'); res.vary('User-Agent');
    try {
      const [rows] = await pool.query('SELECT domain_name, targeting_policy FROM domains WHERE domain_key = ? AND user_id = 1 LIMIT 1', [req.params.key]);
      if (!rows.length) return res.status(404).json({ ok: false });
      let origin; try { origin = new URL(req.get('Origin')); } catch { /* Rejected below. */ }
      if (!origin || origin.protocol !== 'https:' || origin.hostname.replace(/^www\./, '') !== rows[0].domain_name.replace(/^www\./, '')) return res.status(403).json({ ok: false });
      const policy = readTargeting(rows[0].targeting_policy), profile = requestTarget(req, { ipad: req.query.ipad === '1', standalone: req.query.standalone === '1' });
      return res.json({ ok: true, data: { allowed: targetAllowed(policy, profile), ...profile, version: policy.version } });
    } catch { return res.status(503).json({ ok: false }); }
  });
  app.get('/api/domains/:key/targeting', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [rows] = await pool.query('SELECT targeting_policy FROM domains WHERE domain_key = ? AND user_id = 1 LIMIT 1', [req.params.key]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Website not found.' });
      return res.json({ ok: true, data: readTargeting(rows[0].targeting_policy) });
    } catch { return res.status(503).json({ ok: false, message: 'Could not load device and browser rules.' }); }
  });
  app.put('/api/domains/:key/targeting', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const policy = normalizeTargeting(req.body?.policy), version = req.body?.version;
    if (!policy || !Number.isSafeInteger(version) || version < 0) return res.status(400).json({ ok: false, message: 'Choose valid device and browser rules.' });
    try {
      const [rows] = await pool.query('SELECT targeting_policy FROM domains WHERE domain_key = ? AND user_id = 1 LIMIT 1', [req.params.key]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Website not found.' });
      if (readTargeting(rows[0].targeting_policy).version !== version) return res.status(409).json({ ok: false, message: 'Rules changed in another tab. Reload before saving.' });
      const next = { ...policy, version: version + 1 };
      const [result] = await pool.query("UPDATE domains SET targeting_policy = ? WHERE domain_key = ? AND user_id = 1 AND COALESCE(JSON_EXTRACT(targeting_policy, '$.version'), 0) = ?", [JSON.stringify(next), req.params.key, version]);
      if (!result.affectedRows) return res.status(409).json({ ok: false, message: 'Rules changed. Reload before saving.' });
      return res.json({ ok: true, data: next });
    } catch { return res.status(503).json({ ok: false, message: 'Could not save device and browser rules.' }); }
  });
}
