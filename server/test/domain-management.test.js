import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { ensureDomainDisplayName } from '../domain-schema.js';
import { deleteOwnedDomain } from '../domain-management.js';

test('display-name migration leaves an existing column and its data unchanged', async () => {
  let queries = 0;
  await ensureDomainDisplayName({ query: async () => {
    queries++;
    return [[{ Field: 'display_name' }]];
  } });
  assert.equal(queries, 1);
});

test('display-name migration adds a nullable column once and tolerates concurrent startup', async () => {
  for (const concurrent of [false, true]) {
    const queries = [];
    await ensureDomainDisplayName({ query: async sql => {
      queries.push(sql);
      if (queries.length === 1) return [[]];
      assert.match(sql, /ADD COLUMN display_name VARCHAR\(255\) NULL/);
      if (concurrent) throw Object.assign(new Error('already added'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(queries.length, 2);
  }
});

test('migration errors are propagated so the server cannot start with missing storage', async () => {
  await assert.rejects(ensureDomainDisplayName({ query: async sql => {
    if (sql.startsWith('SHOW')) return [[]];
    throw Object.assign(new Error('ALTER permission denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
  } }), /ALTER permission denied/);
});

async function fixture(t) {
  const records = [
    { id: 1, user_id: 1, domain_name: 'micetraveladvisor.com', domain_key: 'stable-domain-key', display_name: null, vapid_public_key: 'stable-public', vapid_private_key: 'stable-private', status: 'pending' },
    { id: 2, user_id: 2, domain_name: 'another-owner.test', domain_key: 'private-domain', display_name: 'Another owner' },
  ];
  const writes = [];
  const pool = { query: async (raw, params) => {
    const sql = raw.trim();
    if (sql.startsWith('UPDATE domains')) {
      assert.equal(sql, 'UPDATE domains SET display_name = ? WHERE id = ? AND user_id = ?');
      writes.push(params);
      const record = records.find(row => row.id === params[1] && row.user_id === params[2]);
      if (!record) return [{ affectedRows: 0 }];
      record.display_name = params[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO domains')) {
      assert.match(sql, /vapid_private_key, display_name,/);
      const [user_id, domain_name, domain_key, status, , vapid_public_key, vapid_private_key, display_name, time_zone] = params;
      records.push({ id: records.length + 1, user_id, domain_name, domain_key, status, vapid_public_key, vapid_private_key, display_name, time_zone });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM domains d')) {
      let rows = records.filter(row => row.user_id === 1);
      if (sql.includes('WHERE d.id = ?')) rows = rows.filter(row => row.id === params[0]);
      if (sql.includes('WHERE d.domain_key = ?')) rows = rows.filter(row => row.domain_key === params[0]);
      return [rows.map(({ vapid_private_key, ...row }) => ({ ...row, display_name: row.display_name || row.domain_name, is_configured: 0 }))];
    }
    throw new Error('Unexpected domain-management query');
  } };
  const app = createApp({ pool, webpush: { generateVAPIDKeys: () => ({ publicKey: 'new-public', privateKey: 'new-private' }) },
    adminUsername: 'admin', adminPassword: 'testing', secret: 'test-secret-at-least-thirty-two-characters', publicApiBase: 'https://push.example.test', vapidSubject: 'mailto:test@example.test' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', payload, token) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  const login = await request('/api/login', 'POST', { username: 'admin', password: 'testing' });
  return { records, writes, request: (route, method, payload, authenticated = true) => request(route, method, payload, authenticated ? login.token : undefined) };
}

test('friendly names persist on create and legacy rows fall back to the registered hostname', async t => {
  const f = await fixture(t);
  const list = await f.request('/api/domains');
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].display_name, 'micetraveladvisor.com');
  const created = await f.request('/api/domains', 'POST', { name: ' Travel & Tour World ', domain_name: 'travel.example.com', time_zone: 'Europe/London' });
  assert.equal(created.status, 200);
  assert.equal(created.data.display_name, 'Travel & Tour World');
  assert.equal(created.data.time_zone, 'Europe/London');
  assert.equal(created.data.vapid_private_key, undefined);
});

test('editing a friendly name keeps the registered hostname, domain key, and VAPID keys', async t => {
  const f = await fixture(t);
  const before = { ...f.records[0] };
  const result = await f.request('/api/domains/1', 'PATCH', { name: ' MICE Travel Advisor ', domain_key: 'replacement', domain_name: 'evil.test', vapid_private_key: 'replacement', user_id: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.data.display_name, 'MICE Travel Advisor');
  assert.equal(result.data.vapid_private_key, undefined);
  assert.deepEqual(f.records[0], { ...before, display_name: 'MICE Travel Advisor' });
  const detail = await f.request('/api/domains/stable-domain-key');
  assert.equal(detail.data.display_name, 'MICE Travel Advisor');
});

test('editing requires authentication, rejects invalid input, and cannot rename another owner', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/domains/1', 'PATCH', { name: 'Name' }, false)).status, 401);
  for (const [id, name] of [['1', ' '], ['1', 'x'.repeat(256)], ['1', null], ['0', 'Name'], ['1.5', 'Name'], ['not-an-id', 'Name']]) {
    assert.equal((await f.request(`/api/domains/${id}`, 'PATCH', { name })).status, 400);
  }
  assert.equal((await f.request('/api/domains/2', 'PATCH', { name: 'Unauthorized edit' })).status, 404);
  assert.equal((await f.request('/api/domains/999', 'PATCH', { name: 'Missing domain' })).status, 404);
  assert.equal(f.records[1].display_name, 'Another owner');
});

test('domain deletion removes only its own subscriptions and commits both changes together', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql, params) => {
      events.push([sql, params]);
      if (sql.startsWith('SELECT id FROM notification_schedules')) return [[]];
      if (sql.startsWith('SELECT')) return [[{ id: 3, domain_key: 'selected-key' }]];
      return [{ affectedRows: 1 }];
    },
    commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release'),
  };
  assert.equal(await deleteOwnedDomain({ getConnection: async () => connection }, 'id', 3, 1), true);
  assert.deepEqual(events, ['begin',
    ['SELECT id, domain_key FROM domains WHERE id = ? AND user_id = ? FOR UPDATE', [3, 1]],
    ["SELECT id FROM notification_schedules WHERE domain_key = ? AND user_id = ? AND status = 'running' LIMIT 1", ['selected-key', 1]],
    ['DELETE r FROM notification_schedule_runs r INNER JOIN notification_schedules j ON j.id = r.schedule_id WHERE j.domain_key = ? AND j.user_id = ?', ['selected-key', 1]],
    ['DELETE FROM notification_schedules WHERE domain_key = ? AND user_id = ?', ['selected-key', 1]],
    ['DELETE FROM subscriptions WHERE domain_key = ? AND user_id = ?', ['selected-key', 1]],
    ['DELETE FROM push_images WHERE domain_key = ?', ['selected-key']],
    ['DELETE FROM prompt_events WHERE domain_key = ?', ['selected-key']],
    ['DELETE FROM domains WHERE id = ? AND user_id = ?', [3, 1]], 'commit', 'release']);
});

test('unknown domains and database failures roll back deletion and release the connection', async () => {
  for (const failure of [false, true]) {
    const events = [];
    const connection = {
      beginTransaction: async () => events.push('begin'),
      query: async sql => {
        if (sql.startsWith('SELECT id FROM notification_schedules')) return [[]];
        if (sql.startsWith('SELECT')) return [failure ? [{ id: 3, domain_key: 'selected-key' }] : []];
        throw new Error('Delete failed');
      },
      commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release'),
    };
    const promise = deleteOwnedDomain({ getConnection: async () => connection }, 'domain_key', 'selected-key', 1);
    if (failure) await assert.rejects(promise, /Delete failed/);
    else assert.equal(await promise, false);
    assert.deepEqual(events, ['begin', 'rollback', 'release']);
  }
});

test('a domain with a scheduled send in progress cannot be deleted midway through delivery', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => {},
    query: async sql => { events.push(sql); return [[sql.includes('notification_schedules') ? { id: 'running-job' } : { id: 1, domain_key: 'site' }]]; },
    rollback: async () => events.push('rollback'), release: () => events.push('release'),
  };
  await assert.rejects(deleteOwnedDomain({ getConnection: async () => connection }, 'id', 1, 1), error => error.code === 'SCHEDULE_RUNNING');
  assert.equal(events.some(sql => sql.startsWith('DELETE')), false);
  assert.deepEqual(events.slice(-2), ['rollback', 'release']);
});
