import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePushAudience, pushAudienceWhere } from '../push-audience.js';

test('audience validation rejects unsupported filters instead of silently sending to everyone', () => {
  assert.deepEqual(parsePushAudience(), { platform: 'all', subscribed: 'all', from: null, to: null });
  for (const value of [null, [], 'desktop', { platform: 'app' }, { platform: ['desktop'] }, { subscribed: 'tomorrow' }, { schedule: 'later' }]) assert.equal(parsePushAudience(value), null);
  const where = pushAudienceWhere("domain' OR 1=1", parsePushAudience({ platform: 'desktop' }));
  assert.ok(where.sql.includes("user_id = ? AND COALESCE(p256dh, '') <> ''"));
  assert.ok(where.sql.endsWith('AND device_type = ?'));
  assert.deepEqual(where.params, ["domain' OR 1=1", 1, 'desktop']);
  assert.equal(where.sql.includes("domain' OR 1=1"), false);
});

test('yesterday is a complete UTC day and rolling periods have exact half-open date boundaries', () => {
  const now = new Date('2026-03-01T00:30:00Z');
  const yesterday = parsePushAudience({ subscribed: 'yesterday' }, now);
  assert.equal(new Date(yesterday.from).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(new Date(yesterday.to).toISOString(), '2026-03-01T00:00:00.000Z');
  for (const days of [7, 15, 30]) {
    const audience = parsePushAudience({ platform: 'mobile', subscribed: `${days}d` }, now);
    assert.equal(audience.to - audience.from, days * 86400000);
    const count = pushAudienceWhere('site', audience, false);
    assert.deepEqual(count.params, ['site', 1, audience.from / 1000, audience.to / 1000]);
    assert.equal(count.sql.includes('AND device_type = ?'), false);
  }
});
