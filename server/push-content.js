import crypto from 'node:crypto';
import express from 'express';
import { validPwaIcon } from './pwa.js';

export const emptyBanner = () => ({ enabled: false, image: '', actions: [{ title: 'Read More', url: '', type: 'link' }] });
export function validImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port; }
  catch { return false; }
}
export function websitePath(value, domainName) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value || '/', `https://${domainName}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.replace(/^www\./, '') !== domainName.replace(/^www\./, '')) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
export function normalizeBanner(value, domainName) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new Error('Choose valid banner settings.');
  if (!value.enabled) return emptyBanner();
  if (!validImageUrl(value.image)) throw new Error('Use a public HTTPS banner image URL.');
  if (!Array.isArray(value.actions) || value.actions.length > 2) throw new Error('Use at most two notification buttons.');
  const actions = value.actions.map((item, index) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 40) throw new Error('Enter a button label of up to 40 characters.');
    const type = item.type || 'link';
    if (!['link', 'facebook', 'x', 'whatsapp', 'call'].includes(type)) throw new Error('Choose a supported button action.');
    const url = type === 'call' ? (typeof item.url === 'string' && /^tel:\+?[0-9]{3,15}$/.test(item.url) ? item.url : null) : websitePath(item.url, domainName);
    if (url === null) throw new Error(type === 'call' ? 'Use a phone link such as tel:+911234567890.' : 'Button links must use HTTPS on the selected website, or a relative path.');
    return { action: `button-${index + 1}`, title: item.title.trim(), type, url: item.url === '' && type !== 'call' ? '' : url };
  });
  return { enabled: true, image: value.image, actions };
}

export function pushImageBodyParser(app) {
  app.use('/api/domains/:key/push-images', express.json({ limit: '710kb' }));
}
export function installPushContent(app, { pool, requireAdmin, publicApiBase }) {
  const read = async key => {
    const [rows] = await pool.query('SELECT domain_name, push_defaults FROM domains WHERE domain_key = ? AND user_id = ?', [key, 1]);
    return rows[0];
  };
  const stored = row => row.push_defaults ? (typeof row.push_defaults === 'string' ? JSON.parse(row.push_defaults) : row.push_defaults) : { icon: '', banner: emptyBanner() };
  app.get('/api/domains/:key/push-defaults', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const row = await read(req.params.key); return row ? res.json({ ok: true, data: stored(row) }) : res.status(404).json({ ok: false, message: 'Website not found.' }); }
    catch { return res.status(503).json({ ok: false, message: 'Could not load notification defaults.' }); }
  });
  app.patch('/api/domains/:key/push-defaults', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const row = await read(req.params.key);
      if (!row) return res.status(404).json({ ok: false, message: 'Website not found.' });
      const body = req.body;
      if (!body || !Object.keys(body).length || Object.keys(body).some(key => !['icon', 'banner'].includes(key))) return res.status(400).json({ ok: false, message: 'Choose icon or banner defaults.' });
      if (Object.hasOwn(body, 'icon') && !validImageUrl(body.icon)) return res.status(400).json({ ok: false, message: 'Use a public HTTPS icon URL, or reset it.' });
      let banner;
      try { if (Object.hasOwn(body, 'banner')) banner = normalizeBanner(body.banner, row.domain_name); }
      catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
      // JSON_SET merges individual defaults atomically, including concurrent tabs.
      const fields = [], params = [];
      if (Object.hasOwn(body, 'icon')) { fields.push("'$.icon', ?"); params.push(body.icon); }
      if (banner) { fields.push("'$.banner', CAST(? AS JSON)"); params.push(JSON.stringify(banner)); }
      await pool.query(`UPDATE domains SET push_defaults = JSON_SET(COALESCE(push_defaults, JSON_OBJECT()), ${fields.join(', ')}) WHERE domain_key = ? AND user_id = ?`, [...params, req.params.key, 1]);
      return res.json({ ok: true });
    } catch { return res.status(503).json({ ok: false, message: 'Could not save notification defaults. Please retry.' }); }
  });
  app.post('/api/domains/:key/push-images', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!await read(req.params.key)) return res.status(404).json({ ok: false, message: 'Website not found.' });
      const value = req.body?.image;
      const png = typeof value === 'string' ? Buffer.from(value.slice(22), 'base64') : Buffer.alloc(0);
      const width = png.length > 24 ? png.readUInt32BE(16) : 0, height = png.length > 24 ? png.readUInt32BE(20) : 0;
      if (!width || !height || width > 1600 || height > 1600 || !validPwaIcon(value, width, height)) return res.status(400).json({ ok: false, message: 'Upload a valid PNG, up to 512 KB and 1600 × 1600 pixels.' });
      const hash = crypto.createHash('sha256').update(png).digest('hex');
      // Immutable image URLs preserve images in notifications already queued.
      await pool.query('INSERT IGNORE INTO push_images (domain_key, image_hash, image_data) VALUES (?, ?, ?)', [req.params.key, hash, png]);
      return res.json({ ok: true, data: { url: `${publicApiBase.replace(/\/$/, '')}/api/push-images/${req.params.key}/${hash}.png` } });
    } catch { return res.status(503).json({ ok: false, message: 'Could not upload the banner image.' }); }
  });
  app.get('/api/push-images/:key/:hash.png', async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.hash)) return res.sendStatus(404);
    try {
      const [rows] = await pool.query('SELECT i.image_data FROM push_images i INNER JOIN domains d ON d.domain_key = i.domain_key WHERE i.domain_key = ? AND i.image_hash = ?', [req.params.key, req.params.hash]);
      if (!rows.length) return res.sendStatus(404);
      return res.type('png').set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(rows[0].image_data);
    } catch { return res.sendStatus(503); }
  });
}
