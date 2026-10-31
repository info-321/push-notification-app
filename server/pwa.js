import express from 'express';
import { inflateSync } from 'node:zlib';

const iconLimit = 512 * 1024;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const normalizeHost = value => value.toLowerCase().replace(/^www\./, '');

// PNG-only uploads keep SVG/HTML out of the public image endpoints. Bound both
// compressed and inflated sizes, and verify the dimensions declared in the UI.
export function validPwaIcon(value, size, height = size) {
  if (typeof value !== 'string' || value.length > Math.ceil(iconLimit / 3) * 4 + 22 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const png = Buffer.from(value.slice(22), 'base64');
    if (png.length < 57 || png.length > iconLimit || !png.subarray(0, 8).equals(pngSignature)) return false;
    if (png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== height) return false;
    const depth = png[24], color = png[25], channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color];
    if (!channels || !depths.includes(depth) || png[26] !== 0 || png[27] !== 0 || png[28] !== 0) return false;
    const chunks = [];
    let ended = false;
    for (let offset = 8; offset + 12 <= png.length;) {
      const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
      if (offset + 12 + length > png.length) return false;
      if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
      if (type === 'IEND') { ended = length === 0 && offset === png.length; break; }
    }
    if (!ended || !chunks.length) return false;
    const row = Math.ceil(size * channels * depth / 8) + 1;
    const data = inflateSync(Buffer.concat(chunks), { maxOutputLength: row * height });
    if (data.length !== row * height) return false;
    for (let offset = 0; offset < data.length; offset += row) if (data[offset] > 4) return false;
    return true;
  } catch { return false; }
}

export function pwaDefaults(domain) {
  const name = domain.display_name || domain.domain_name;
  return { name, short_name: name.slice(0, 30), start_url: `https://${domain.domain_name}/`, theme_color: '#ffffff', background_color: '#ffffff', icon_192: '', icon_512: '' };
}

function storedSettings(domain) {
  return domain.pwa_settings ? (typeof domain.pwa_settings === 'string' ? JSON.parse(domain.pwa_settings) : domain.pwa_settings) : null;
}

function validate(body, domain) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) return 'Enter an app name of up to 100 characters.';
  if (typeof body.short_name !== 'string' || !body.short_name.trim() || body.short_name.trim().length > 30) return 'Enter a short name of up to 30 characters.';
  try {
    if (typeof body.start_url !== 'string' || body.start_url.length > 2048) return 'Enter a valid HTTPS start URL for this website.';
    const url = new URL(body.start_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || normalizeHost(url.hostname) !== normalizeHost(domain.domain_name)) return 'Start URL must be an HTTPS address on this website.';
  } catch { return 'Enter a valid HTTPS start URL for this website.'; }
  for (const field of ['theme_color', 'background_color']) if (typeof body[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(body[field])) return 'Use six-digit hex colors, such as #ffffff.';
  for (const size of [192, 512]) if (!validPwaIcon(body[`icon_${size}`], size)) return `Choose a non-interlaced ${size} x ${size} PNG icon, up to 512 KB.`;
  return null;
}

export function installPwa(app, pool) {
  const readDomain = async key => {
    const [rows] = await pool.query('SELECT domain_key, domain_name, display_name, pwa_settings FROM domains WHERE domain_key = ? AND user_id = ?', [key, 1]);
    return rows[0];
  };
  const failure = (res, error) => {
    console.error('PWA settings unavailable:', error.code);
    return res.status(500).json({ ok: false, message: 'Could not load or save PWA settings. Please try again.' });
  };

  // These routes inherit the /api/domains administrator middleware.
  app.get('/api/domains/:key/pwa', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const domain = await readDomain(req.params.key);
      if (!domain) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const saved = storedSettings(domain);
      return res.json({ ok: true, data: { domain_key: domain.domain_key, domain_name: domain.domain_name, settings: saved || pwaDefaults(domain), saved: Boolean(saved) } });
    } catch (error) { return failure(res, error); }
  });

  app.put('/api/domains/:key/pwa', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const domain = await readDomain(req.params.key);
      if (!domain) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      const message = validate(req.body, domain);
      if (message) return res.status(400).json({ ok: false, message });
      const settings = {
        name: req.body.name.trim(), short_name: req.body.short_name.trim(), start_url: new URL(req.body.start_url).href,
        theme_color: req.body.theme_color.toLowerCase(), background_color: req.body.background_color.toLowerCase(),
        icon_192: req.body.icon_192, icon_512: req.body.icon_512,
      };
      const [result] = await pool.query('UPDATE domains SET pwa_settings = ? WHERE domain_key = ? AND user_id = ?', [JSON.stringify(settings), req.params.key, 1]);
      if (!result.affectedRows) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      return res.json({ ok: true, data: { domain_key: domain.domain_key, domain_name: domain.domain_name, settings, saved: true } });
    } catch (error) { return failure(res, error); }
  });

  // Only saved app icons are public. No settings, account data, or push keys.
  app.get('/api/pwa/:key/icon-:size.png', async (req, res) => {
    if (!['192', '512'].includes(req.params.size)) return res.sendStatus(404);
    try {
      const domain = await readDomain(req.params.key);
      const icon = domain && storedSettings(domain)?.[`icon_${req.params.size}`];
      if (!icon) return res.sendStatus(404);
      res.set({ 'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff' });
      return res.type('png').send(Buffer.from(icon.slice(22), 'base64'));
    } catch (error) { return failure(res, error); }
  });
}

// Apply a larger, bounded JSON limit only to the PNG-bearing PWA form.
export function pwaBodyParser(app) {
  app.use('/api/domains/:key/pwa', express.json({ limit: '1500kb' }), (error, req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ ok: false, message: 'PWA upload is too large. Each PNG must be at most 512 KB.' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, message: 'Invalid PWA settings.' });
    next(error);
  });
}
