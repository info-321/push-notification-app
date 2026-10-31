import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { normalizeBanner, websitePath, validImageUrl } from '../push-content.js';
import { ensurePushContent } from '../domain-schema.js';

test('banner actions validate links, sharing, calls, image URLs, and button limits', () => {
  const banner = { enabled: true, image: 'https://cdn.test/banner.png', actions: [{ title: 'Read More', type: 'link', url: '/news?q=1#story' }] };
  assert.equal(normalizeBanner(banner, 'website.test').actions[0].url, '/news?q=1#story');
  for (const url of ['https://evil.test/', 'javascript:alert(1)', 'https://user:pass@website.test/', '//evil.test/', 'https://website.test:8080/']) assert.throws(() => normalizeBanner({ ...banner, actions: [{ title: 'Go', type: 'link', url }] }, 'website.test'));
  for (const type of ['facebook', 'x', 'whatsapp']) assert.equal(normalizeBanner({ ...banner, actions: [{ title: 'Share', type, url: '' }] }, 'website.test').actions[0].type, type);
  assert.equal(normalizeBanner({ ...banner, actions: [{ title: 'Call', type: 'call', url: 'tel:+911234567890' }] }, 'website.test').actions[0].url, 'tel:+911234567890');
  for (const url of ['tel:1;ext=2', 'javascript:alert(1)', 'tel:123\n']) assert.throws(() => normalizeBanner({ ...banner, actions: [{ title: 'Call', type: 'call', url }] }, 'website.test'));
  assert.throws(() => normalizeBanner({ ...banner, actions: Array(3).fill(banner.actions[0]) }, 'website.test'));
  assert.throws(() => normalizeBanner({ ...banner, image: 'data:image/svg+xml,abc' }, 'website.test'));
  assert.equal(websitePath('https://www.website.test/path', 'website.test'), '/path');
  assert.equal(validImageUrl('https://user:secret@cdn.test/icon'), false);
});

test('content migration adds nullable defaults and immutable image storage without touching existing keys', async () => {
  for (const existing of [true, false]) {
    const queries = [];
    await ensurePushContent({ query: async sql => { queries.push(sql); return sql.startsWith('SHOW') ? [existing ? [{}] : []] : [{}]; } });
    assert.equal(queries.some(sql => sql.startsWith('ALTER')), !existing);
    assert.match(queries.at(-1), /CREATE TABLE IF NOT EXISTS push_images/);
    assert.ok(queries.every(sql => !sql.includes('vapid')));
  }
});

test('defaults persist per owner and website; uploads require login and public images are immutable PNGs', async t => {
  const rows = [{ domain_key: 'one', user_id: 1, domain_name: 'website.test', push_defaults: null }, { domain_key: 'two', user_id: 1, domain_name: 'other.test' }, { domain_key: 'private', user_id: 2, domain_name: 'private.test' }];
  const images = new Map();
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('SELECT domain_name, push_defaults')) return [rows.filter(row => row.domain_key === params[0] && row.user_id === params[1])];
    if (sql.startsWith('UPDATE domains SET push_defaults')) {
      const row = rows.find(item => item.domain_key === params.at(-2) && item.user_id === params.at(-1));
      const values = row.push_defaults || {};
      let i = 0;
      if (sql.includes("'$.icon'")) values.icon = params[i++];
      if (sql.includes("'$.banner'")) values.banner = JSON.parse(params[i]);
      row.push_defaults = values; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT IGNORE INTO push_images')) { images.set(params[0] + params[1], params[2]); return [{}]; }
    if (sql.startsWith('SELECT i.image_data')) return [images.has(params[0] + params[1]) ? [{ image_data: images.get(params[0] + params[1]) }] : []];
    throw new Error('Unexpected test query');
  } };
  const server = createApp({ pool, webpush: {}, secret: 'content-test-secret-at-least-thirty-two', adminUsername: 'admin', adminPassword: 'testing', publicApiBase: 'https://push.test' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'testing' }) })).json();
  const request = (route, method = 'GET', body, auth = true) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('/api/domains/one/push-defaults', 'GET', null, false)).status, 401);
  assert.equal((await request('/api/domains/private/push-defaults')).status, 404);
  assert.equal((await request('/api/domains/one/push-defaults', 'PATCH', { icon: 'https://cdn.test/icon.png' })).status, 200);
  const banner = { enabled: true, image: '', actions: [{ title: 'Read', url: '', type: 'link' }] };
  assert.equal((await request('/api/domains/one/push-defaults', 'PATCH', { banner })).status, 200);
  const defaults = (await (await request('/api/domains/one/push-defaults')).json()).data;
  assert.equal(defaults.icon, 'https://cdn.test/icon.png'); assert.equal(defaults.banner.enabled, true);
  assert.equal((await (await request('/api/domains/two/push-defaults')).json()).data.icon, '');
  assert.equal((await request('/api/domains/one/push-defaults', 'PATCH', { icon: '' })).status, 200);
  assert.equal((await request('/api/domains/one/push-defaults', 'PATCH', { icon: 'http://cdn.test/icon.png' })).status, 400);
  assert.equal((await request('/api/domains/one/push-defaults', 'PATCH', { banner: { ...banner, actions: [{ title: 'Go', url: 'https://evil.test/' }] } })).status, 400);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=';
  assert.equal((await request('/api/domains/one/push-images', 'POST', { image }, false)).status, 401);
  assert.equal((await request('/api/domains/private/push-images', 'POST', { image })).status, 404);
  assert.equal((await request('/api/domains/one/push-images', 'POST', { image: 'data:image/svg+xml,<svg></svg>' })).status, 400);
  const upload = await request('/api/domains/one/push-images', 'POST', { image });
  assert.equal(upload.status, 200);
  const path = new URL((await upload.json()).data.url).pathname;
  const publicImage = await request(path, 'GET', null, false);
  assert.equal(publicImage.status, 200); assert.equal(publicImage.headers.get('content-type'), 'image/png');
  assert.match(publicImage.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), Buffer.from(image.slice(22), 'base64'));
});
