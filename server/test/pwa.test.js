import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createApp } from '../app.js';
import { validPwaIcon } from '../pwa.js';
import { ensureDomainPwa } from '../domain-schema.js';

// Small, genuinely decodable PNGs rather than mocked upload headers.
function png(size) {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((size * 4 + 1) * size))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const settings = { name: 'MICE Travel Advisor', short_name: 'MICE', start_url: 'https://www.micetraveladvisor.com/news/', theme_color: '#123ABC', background_color: '#ffffff', icon_192: png(192), icon_512: png(512) };

async function fixture(t) {
  const records = [{ domain_key: 'mice', user_id: 1, domain_name: 'micetraveladvisor.com', display_name: 'MICE Travel Advisor', pwa_settings: null, vapid_private_key: 'private-unchanged' }, { domain_key: 'second', user_id: 1, domain_name: 'second.test', pwa_settings: null }, { domain_key: 'private', user_id: 2, domain_name: 'other.test', pwa_settings: null }];
  const writes = [];
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('SELECT domain_key, domain_name, display_name, pwa_settings')) {
      assert.match(sql, /WHERE domain_key = \? AND user_id = \?/);
      return [records.filter(row => row.domain_key === params[0] && row.user_id === params[1]).map(({ domain_key, domain_name, display_name, pwa_settings }) => ({ domain_key, domain_name, display_name, pwa_settings }))];
    }
    assert.equal(sql, 'UPDATE domains SET pwa_settings = ? WHERE domain_key = ? AND user_id = ?');
    const row = records.find(row => row.domain_key === params[1] && row.user_id === params[2]);
    if (!row) return [{ affectedRows: 0 }];
    writes.push(params); row.pwa_settings = params[0]; return [{ affectedRows: 1 }];
  } };
  const app = createApp({ pool, webpush: {}, adminUsername: 'admin', adminPassword: 'test-pass', secret: 'pwa-tests-secret-long-enough-for-auth', publicApiBase: 'https://push.example.test', vapidSubject: 'mailto:test@example.test' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test-pass' }) })).json();
  const request = async (key = 'mice', method = 'GET', body, auth = true) => {
    const response = await fetch(`${base}/api/domains/${key}/pwa`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, ...await response.json() };
  };
  return { records, writes, request, base };
}

test('PWA migration is additive and safe for existing or concurrent startups', async () => {
  for (const state of ['present', 'missing', 'concurrent']) {
    let changes = 0;
    await ensureDomainPwa({ query: async sql => {
      if (sql.startsWith('SHOW')) return [state === 'present' ? [{ Field: 'pwa_settings' }] : []];
      assert.equal(sql, 'ALTER TABLE domains ADD COLUMN pwa_settings JSON NULL'); changes++;
      if (state === 'concurrent') throw Object.assign(new Error('exists'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(changes, state === 'present' ? 0 : 1);
  }
});

test('PWA settings require authentication and default to the selected website without credentials', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('mice', 'GET', undefined, false)).status, 401);
  const result = await f.request();
  assert.equal(result.data.saved, false);
  assert.equal(result.data.settings.name, 'MICE Travel Advisor');
  assert.equal(result.data.settings.start_url, 'https://micetraveladvisor.com/');
  assert.equal(JSON.stringify(result).includes('private-unchanged'), false);
  assert.equal((await f.request('private')).status, 404);
  assert.equal((await f.request('missing')).status, 404);
});

test('PWA settings and both icons persist together without changing another website or push keys', async t => {
  const f = await fixture(t), before = structuredClone(f.records);
  const result = await f.request('mice', 'PUT', { ...settings, name: ' MICE Travel Advisor ', vapid_private_key: 'forged' });
  assert.equal(result.status, 200);
  assert.equal(result.data.saved, true);
  assert.equal(result.data.settings.name, 'MICE Travel Advisor');
  assert.equal(result.data.settings.theme_color, '#123abc');
  assert.deepEqual((await f.request()).data, result.data);
  assert.equal(f.records[0].vapid_private_key, before[0].vapid_private_key);
  assert.deepEqual(f.records.slice(1), before.slice(1));
  assert.equal((await f.request('private', 'PUT', settings)).status, 404);
});

test('only saved PNGs are served publicly, with the correct content type and no credentials', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/api/pwa/mice/icon-192.png')).status, 404);
  await f.request('mice', 'PUT', settings);
  for (const size of [192, 512]) {
    const response = await fetch(`${f.base}/api/pwa/mice/icon-${size}.png`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(settings[`icon_${size}`].slice(22), 'base64'));
  }
  for (const route of ['/api/pwa/private/icon-192.png', '/api/pwa/missing/icon-192.png', '/api/pwa/mice/icon-999.png']) assert.equal((await fetch(f.base + route)).status, 404);
});

test('invalid URLs, names, colors, dimensions, corrupt PNGs and unauthorized writes leave data unchanged', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('mice', 'PUT', settings, false)).status, 401);
  for (const patch of [{ name: '' }, { name: 'x'.repeat(101) }, { short_name: 'x'.repeat(31) }, { theme_color: 'red' }, { background_color: '#123' }, { start_url: 'https://evil.test/' }, { start_url: 'http://micetraveladvisor.com/' }, { start_url: 'https://user:pass@micetraveladvisor.com/' }, { start_url: 'https://micetraveladvisor.com:1234/' }, { icon_192: settings.icon_512 }, { icon_512: 'data:image/svg+xml;base64,PHN2Zz4=' }, { icon_192: settings.icon_192.slice(0, -20) }]) {
    assert.equal((await f.request('mice', 'PUT', { ...settings, ...patch })).status, 400);
  }
  assert.equal(f.writes.length, 0);
  assert.equal(validPwaIcon('data:image/png;base64,' + 'A'.repeat(800000), 512), false);
  const oversized = await f.request('mice', 'PUT', { ...settings, icon_512: 'A'.repeat(1600000) });
  assert.equal(oversized.status, 413);
});

test('PWA form accepts bounded PNG payloads larger than the standard 32 KB JSON limit', async t => {
  const f = await fixture(t);
  // Valid PNG ancillary chunk expands the compressed payload without large decoded pixels.
  const bytes = Buffer.from(settings.icon_512.slice(22), 'base64');
  const chunk = Buffer.alloc(45012); chunk.writeUInt32BE(45000); chunk.write('tEXt', 4);
  const icon = 'data:image/png;base64,' + Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]).toString('base64');
  assert.equal((await f.request('mice', 'PUT', { ...settings, icon_512: icon })).status, 200);
});
