import crypto from 'node:crypto';
import { analyticsRange } from './analytics.js';
import { validImageUrl } from './push-content.js';
export const promptTemplates = ['button', 'slide-in', 'dialog', 'modal', 'fullscreen', 'sticky'];
export const mobilePromptTemplates = ['native', 'dialog', 'modal', 'fullscreen', 'header', 'slide-up', 'sticky'];
const validDevice = device => device === 'large' || device === 'mobile';

export const promptDefaults = name => ({ enabled: true, template: 'slide-in', heading: 'Stay up to date', message: `Get the latest news from ${name}.`, allow_label: 'Enable notifications', dismiss_label: 'Maybe later', logo: '', accent: '#12ad88', background: '#ffffff', text: '#25394b', position: 'right', trigger: 'delay', delay: 15, scroll: 50, cooldown: 7, include_paths: [], exclude_paths: [] });
export function validatePrompt(value, device = 'large') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter valid prompt settings.');
  const result = {};
  if (typeof value.enabled !== 'boolean') throw new Error('Choose whether the prompt is enabled.');
  result.enabled = value.enabled;
  for (const [key, options] of Object.entries({ template: device === 'mobile' ? mobilePromptTemplates : promptTemplates, position: ['left', 'right'], trigger: ['delay', 'scroll'] })) {
    if (!options.includes(value[key])) throw new Error(`Choose a valid ${key}.`);
    result[key] = value[key];
  }
  for (const [key, max] of [['heading', 80], ['message', 240], ['allow_label', 40], ['dismiss_label', 40]]) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > max) throw new Error(`Enter ${key.replace('_', ' ')} (up to ${max} characters).`);
    result[key] = value[key].trim();
  }
  if (!validImageUrl(value.logo)) throw new Error('Use a public HTTPS logo URL, or leave it blank.');
  result.logo = value.logo;
  for (const key of ['accent', 'background', 'text']) {
    if (!/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error('Use six-digit hex colors.');
    result[key] = value[key];
  }
  for (const [key, min, max] of [['delay', 0, 120], ['scroll', 10, 90], ['cooldown', 1, 90]]) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`Choose ${key} between ${min} and ${max}.`);
    result[key] = value[key];
  }
  for (const key of ['include_paths', 'exclude_paths']) {
    if (!Array.isArray(value[key]) || value[key].length > 20 || value[key].some(path => typeof path !== 'string' || !/^\/(?!\/)[^?#\s]*$/.test(path) || path.length > 200)) throw new Error('Use up to 20 website paths, starting with /, without queries or spaces.');
    result[key] = [...new Set(value[key])];
  }
  return result;
}
const unpack = (row, device = 'large') => {
  const saved = row.subscription_prompt ? (typeof row.subscription_prompt === 'string' ? JSON.parse(row.subscription_prompt) : row.subscription_prompt) : {};
  const value = (device === 'mobile' ? saved.mobile : saved) || {};
  return { version: value.version || '0', draft: value.draft || { ...promptDefaults(row.domain_name), ...(device === 'mobile' ? { template: 'dialog' } : {}) }, published: value.published || null, previous: value.previous || null };
};
const sign = (secret, value) => crypto.createHmac('sha256', secret).update(`prompt:${value}`).digest('base64url');
export function readPromptToken(secret, token, key) {
  if (typeof token !== 'string' || token.length > 1200) return null;
  try {
    const [payload, mac, extra] = token.split('.'), expected = sign(secret, payload);
    if (extra || typeof mac !== 'string' || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url'));
    const device = data.device || 'large';
    if (data.key !== key || data.exp < Date.now() || !Number.isFinite(data.exp) || !/^[a-f0-9]{32}$/.test(data.nonce) || !/^[a-f0-9]{16}$/.test(data.revision) || !validDevice(device) || !(device === 'mobile' ? mobilePromptTemplates : promptTemplates).includes(data.template)) return null;
    data.device = device;
    return data;
  } catch { return null; }
}
export async function recordPromptSubscription(pool, secret, token, key, subscriptionId) {
  const data = readPromptToken(secret, token, key);
  if (!data || !subscriptionId) return;
  await pool.query(`UPDATE prompt_events SET subscribed_at = NOW(), subscription_id = ? WHERE domain_key = ? AND session_id = ? AND clicked_at IS NOT NULL AND subscribed_at IS NULL`, [subscriptionId, key, data.nonce]);
}

export function installSubscriptionPrompts(app, { pool, secret, requireAdmin }) {
  const read = async key => {
    const [rows] = await pool.query('SELECT domain_name, subscription_prompt FROM domains WHERE domain_key = ? AND user_id = ?', [key, 1]);
    return rows[0];
  };
  const originMatches = (req, row) => {
    try { const origin = new URL(req.get('Origin')); return origin.protocol === 'https:' && !origin.port && origin.origin === req.get('Origin') && origin.hostname.replace(/^www\./, '') === row.domain_name.replace(/^www\./, ''); }
    catch { return false; }
  };
  // Bounded, short-lived rate counters; no visitor IP is written to the database.
  const limits = new Map();
  const rateLimit = (req, res, next) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(req.params.key)) return res.status(404).json({ ok: false });
    const key = `${req.params.key}:${req.socket.remoteAddress}`;
    const now = Date.now(), current = limits.get(key);
    if (!current || current.until < now) {
      if (limits.size > 10000) limits.clear();
      limits.set(key, { until: now + 60000, count: 1 }); return next();
    }
    if (++current.count > 1500) return res.status(429).json({ ok: false });
    return next();
  };
  app.get('/api/domains/:key/prompt-settings', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const device = req.query.device || 'large';
    if (!validDevice(device)) return res.status(400).json({ ok: false, message: 'Choose desktop/tablet or mobile settings.' });
    try { const row = await read(req.params.key); return row ? res.json({ ok: true, data: unpack(row, device) }) : res.status(404).json({ ok: false, message: 'Website not found.' }); }
    catch { return res.status(503).json({ ok: false, message: 'Could not load subscription prompt settings.' }); }
  });
  app.post('/api/domains/:key/prompt-settings', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const row = await read(req.params.key);
      if (!row) return res.status(404).json({ ok: false, message: 'Website not found.' });
      const { operation, version, settings, device = 'large' } = req.body || {};
      if (!validDevice(device)) return res.status(400).json({ ok: false, message: 'Choose desktop/tablet or mobile settings.' });
      const state = unpack(row, device);
      if (!['save', 'publish', 'restore'].includes(operation)) return res.status(400).json({ ok: false, message: 'Choose Save draft, Publish, or Restore.' });
      if (version !== state.version) return res.status(409).json({ ok: false, message: 'Settings changed in another tab. Reload settings before saving.' });
      if (operation === 'restore' && !state.previous) return res.status(400).json({ ok: false, message: 'There is no previous published version.' });
      let draft;
      try { draft = operation === 'restore' ? validatePrompt(state.previous.settings, device) : validatePrompt(settings, device); }
      catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
      const next = { ...state, draft, version: crypto.randomBytes(8).toString('hex') };
      if (operation !== 'save') {
        next.previous = state.published;
        next.published = { revision: crypto.randomBytes(8).toString('hex'), published_at: new Date().toISOString(), settings: draft };
      }
      // Merge only the selected device group, even when the other editor publishes concurrently.
      const expressions = device === 'mobile' ? "'$.mobile', CAST(? AS JSON)" : "'$.version', ?, '$.draft', CAST(? AS JSON), '$.published', CAST(? AS JSON), '$.previous', CAST(? AS JSON)";
      const values = device === 'mobile' ? [JSON.stringify(next)] : [next.version, JSON.stringify(next.draft), JSON.stringify(next.published), JSON.stringify(next.previous)];
      const versionPath = device === 'mobile' ? '$.mobile.version' : '$.version';
      const [result] = await pool.query(`UPDATE domains SET subscription_prompt = JSON_SET(COALESCE(subscription_prompt, JSON_OBJECT()), ${expressions}) WHERE domain_key = ? AND user_id = ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(subscription_prompt, '${versionPath}')), '0') = ?`, [...values, req.params.key, 1, version]);
      if (!result.affectedRows) return res.status(409).json({ ok: false, message: 'Settings changed in another tab. Reload settings before saving.' });
      return res.json({ ok: true, data: next });
    } catch { return res.status(503).json({ ok: false, message: 'Could not save subscription prompt settings.' }); }
  });
  app.get('/api/prompt/:key', rateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const device = req.query.device || 'large';
    if (!validDevice(device)) return res.status(400).json({ ok: false });
    try {
      const row = await read(req.params.key);
      if (!row) return res.status(404).json({ ok: false });
      if (!originMatches(req, row)) return res.status(403).json({ ok: false });
      const published = unpack(row, device).published;
      if (!published) return res.json({ ok: true, data: { prompt: null } });
      const payload = Buffer.from(JSON.stringify({ key: req.params.key, device, revision: published.revision, template: published.settings.template, nonce: crypto.randomBytes(16).toString('hex'), exp: Date.now() + 86400000 })).toString('base64url');
      return res.json({ ok: true, data: { prompt: published.settings, device, revision: published.revision, token: `${payload}.${sign(secret, payload)}` } });
    } catch { return res.status(503).json({ ok: false }); }
  });
  app.post('/api/prompt/:key/events', rateLimit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { token, event, outcome } = req.body || {}, data = readPromptToken(secret, token, req.params.key);
    if (!data || !['view', 'click', 'dismiss', 'permission'].includes(event) || (event === 'permission' && !['granted', 'denied', 'default'].includes(outcome))) return res.status(400).json({ ok: false });
    try {
      const row = await read(req.params.key);
      if (!row || !originMatches(req, row)) return res.status(403).json({ ok: false });
      if (event === 'view') await pool.query('INSERT IGNORE INTO prompt_events (domain_key, session_id, revision, template, device_group) VALUES (?, ?, ?, ?, ?)', [req.params.key, data.nonce, data.revision, data.template, data.device]);
      else if (event === 'click') await pool.query('UPDATE prompt_events SET clicked_at = COALESCE(clicked_at, NOW()) WHERE domain_key = ? AND session_id = ? AND dismissed_at IS NULL', [req.params.key, data.nonce]);
      else if (event === 'dismiss') await pool.query('UPDATE prompt_events SET dismissed_at = COALESCE(dismissed_at, NOW()) WHERE domain_key = ? AND session_id = ? AND clicked_at IS NULL', [req.params.key, data.nonce]);
      else await pool.query('UPDATE prompt_events SET permission_outcome = ? WHERE domain_key = ? AND session_id = ? AND clicked_at IS NOT NULL AND permission_outcome IS NULL', [outcome, req.params.key, data.nonce]);
      return res.json({ ok: true });
    } catch { return res.status(503).json({ ok: false }); }
  });
  app.get('/api/domains/:key/prompt-performance', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const range = analyticsRange(req.query);
    const device = req.query.device || 'large';
    if (!validDevice(device)) return res.status(400).json({ ok: false, message: 'Choose desktop/tablet or mobile results.' });
    if (!range) return res.status(400).json({ ok: false, message: 'Choose valid dates, up to today, spanning at most 366 days.' });
    try {
      if (!await read(req.params.key)) return res.status(404).json({ ok: false, message: 'Website not found.' });
      const [rows] = await pool.query(`SELECT revision, template, COUNT(*) AS views, SUM(clicked_at IS NOT NULL) AS clicks, SUM(dismissed_at IS NOT NULL) AS dismissals, SUM(subscribed_at IS NOT NULL) AS subscriptions FROM prompt_events WHERE domain_key = ? AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?) AND device_group = ? GROUP BY revision, template ORDER BY MIN(created_at) DESC`, [req.params.key, range.first.getTime() / 1000, range.afterLast.getTime() / 1000, device]);
      const clean = rows.map(row => ({ revision: row.revision, template: row.template, ...Object.fromEntries(['views', 'clicks', 'dismissals', 'subscriptions'].map(key => [key, Number(row[key])])) }));
      return res.json({ ok: true, data: { rows: clean, device, start: range.start, end: range.end } });
    } catch { return res.status(503).json({ ok: false, message: 'Could not load prompt performance.' }); }
  });
}
