import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule, scheduleSlot, nextScheduleSlot } from '../schedule-time.js';

const now = Date.parse('2026-01-01T00:00:00Z');
const base = { kind: 'recurring', start: '2026-01-31T09:30', time_zone: 'Asia/Kolkata', frequency: 'monthly', interval: 1, end_mode: 'count', count: 4 };
const dates = (spec, n = 4) => Array.from({ length: n }, (_, i) => scheduleSlot(spec, i)).filter(Boolean).map(s => new Date(s.at).toISOString());

test('one-time scheduling converts the selected wall clock to UTC and never repeats', () => {
  const spec = validateSchedule({ ...base, kind: 'once' }, now);
  assert.deepEqual(spec, { kind: 'once', start: base.start, time_zone: base.time_zone });
  assert.deepEqual(dates(spec), ['2026-01-31T04:00:00.000Z']);
  assert.equal(nextScheduleSlot(spec, 0, Date.parse('2026-02-01')), null);
});
test('monthly schedules constrain short months without drifting from the original day', () => {
  assert.deepEqual(dates(validateSchedule(base, now)), ['2026-01-31T04:00:00.000Z', '2026-02-28T04:00:00.000Z', '2026-03-31T04:00:00.000Z', '2026-04-30T04:00:00.000Z']);
});
test('weekly intervals anchor to Monday, include only chosen days, and honor inclusive end dates', () => {
  const spec = validateSchedule({ ...base, start: '2026-01-07T09:30', frequency: 'weekly', interval: 2, weekdays: [5, 1, 5], end_mode: 'date', end_date: '2026-01-23' }, now);
  assert.deepEqual(spec.weekdays, [1, 5]);
  assert.deepEqual(dates(spec, 6), ['2026-01-09T04:00:00.000Z', '2026-01-19T04:00:00.000Z', '2026-01-23T04:00:00.000Z']);
});
test('daily recurrence preserves local time across DST, shifts gaps, and sends repeated times once', () => {
  const spring = validateSchedule({ ...base, start: '2026-03-07T02:30', time_zone: 'America/New_York', frequency: 'daily' }, now);
  assert.deepEqual(dates(spring, 3), ['2026-03-07T07:30:00.000Z', '2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z']);
  const fall = validateSchedule({ ...spring, start: '2026-10-31T01:30' }, now);
  assert.deepEqual(dates(fall, 3), ['2026-10-31T05:30:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
});
test('missed slots are skipped efficiently and count limits refer to planned occurrences', () => {
  const spec = validateSchedule({ ...base, frequency: 'daily', end_mode: 'never' }, now);
  const expected = scheduleSlot(spec, 8000);
  assert.deepEqual(nextScheduleSlot(spec, 0, expected.at - 1), expected);
  assert.deepEqual(nextScheduleSlot(spec, 0, expected.at), scheduleSlot(spec, 8001));
  assert.equal(nextScheduleSlot(validateSchedule(base, now), 0, Date.parse('2027-01-01')), null);
});
test('invalid, ambiguous, past and impossible schedules are rejected before being saved', () => {
  for (const change of [
    { kind: 'other' }, { start: '2026-01-01T00:00' }, { start: '2032-01-01T00:00' }, { start: '2026-02-31T12:00' },
    { time_zone: 'not-a-zone' }, { frequency: 'hourly' }, { interval: 0 }, { interval: 1.5 }, { count: 0 }, { count: 1001 },
    { frequency: 'weekly', weekdays: [] }, { frequency: 'weekly', weekdays: [0] },
    { start: '2026-03-08T02:30', time_zone: 'America/New_York' }, { start: '2026-11-01T01:30', time_zone: 'America/New_York' },
    { end_mode: 'date', end_date: '2026-02-31' }, { end_mode: 'date', end_date: '2026-01-01' },
    { start: '2026-01-07T09:30', frequency: 'weekly', weekdays: [1], end_mode: 'date', end_date: '2026-01-08' },
  ]) assert.throws(() => validateSchedule({ ...base, ...change }, now), undefined, JSON.stringify(change));
});
