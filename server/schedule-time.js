import { Temporal } from '@js-temporal/polyfill';

export function validateSchedule(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || !['once', 'recurring'].includes(value.kind)) throw new Error('Choose a one-time or recurring schedule.');
  if (typeof value.time_zone !== 'string' || value.time_zone.length > 64) throw new Error('Choose an IANA time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: value.time_zone }).format(); } catch { throw new Error('Choose a valid IANA time zone.'); }
  if (typeof value.start !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.start)) throw new Error('Choose a valid start date and time.');
  let start;
  try { start = Temporal.PlainDateTime.from(value.start, { overflow: 'reject' }).toZonedDateTime(value.time_zone, { disambiguation: 'reject' }); }
  catch { throw new Error('That local time is invalid or occurs twice due to a clock change. Choose another start time.'); }
  if (start.epochMilliseconds < now + 60000 || start.epochMilliseconds > now + 5 * 366 * 86400000) throw new Error('Choose a start time at least one minute ahead and within the next five years.');
  const result = { kind: value.kind, time_zone: value.time_zone, start: value.start };
  if (value.kind === 'recurring') {
    if (!['daily', 'weekly', 'monthly'].includes(value.frequency)) throw new Error('Choose daily, weekly, or monthly recurrence.');
    if (!Number.isInteger(value.interval) || value.interval < 1 || value.interval > ({ daily: 365, weekly: 52, monthly: 12 })[value.frequency]) throw new Error('Choose a valid repeat interval.');
    result.frequency = value.frequency; result.interval = value.interval;
    if (value.frequency === 'weekly') {
      if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Choose at least one weekday.');
      result.weekdays = [...new Set(value.weekdays)].sort((a, b) => a - b);
    }
    if (!['count', 'date', 'never'].includes(value.end_mode)) throw new Error('Choose when the recurring schedule ends.');
    result.end_mode = value.end_mode;
    if (value.end_mode === 'count') {
      if (!Number.isInteger(value.count) || value.count < 1 || value.count > 1000) throw new Error('Choose between 1 and 1000 occurrences.');
      result.count = value.count;
    } else if (value.end_mode === 'date') {
      try { if (!/^\d{4}-\d{2}-\d{2}$/.test(value.end_date) || Temporal.PlainDate.compare(Temporal.PlainDate.from(value.end_date, { overflow: 'reject' }), start.toPlainDate()) < 0) throw new Error(); }
      catch { throw new Error('Choose an end date on or after the start date.'); }
      result.end_date = value.end_date;
    }
  }
  if (!scheduleSlot(result, 0)) throw new Error('No occurrence fits the selected dates and weekdays.');
  return result;
}

// Always calculate from the original wall-clock anchor, not the last sent time.
export function scheduleSlot(spec, index) {
  if (!Number.isInteger(index) || index < 0 || spec.kind === 'once' && index > 0 || spec.end_mode === 'count' && index >= spec.count) return null;
  const anchor = Temporal.PlainDateTime.from(spec.start);
  let local = anchor;
  if (spec.kind === 'recurring') {
    if (spec.frequency === 'daily') local = anchor.add({ days: index * spec.interval });
    else if (spec.frequency === 'monthly') local = anchor.add({ months: index * spec.interval }, { overflow: 'constrain' });
    else {
      const first = spec.weekdays.filter(day => day >= anchor.dayOfWeek);
      let week = 0, day;
      if (index < first.length) day = first[index];
      else { const rest = index - first.length; week = (Math.floor(rest / spec.weekdays.length) + 1) * spec.interval; day = spec.weekdays[rest % spec.weekdays.length]; }
      local = anchor.subtract({ days: anchor.dayOfWeek - 1 }).add({ weeks: week, days: day - 1 });
    }
    if (spec.end_mode === 'date' && Temporal.PlainDate.compare(local.toPlainDate(), Temporal.PlainDate.from(spec.end_date)) > 0) return null;
  }
  return { index, at: local.toZonedDateTime(spec.time_zone, { disambiguation: 'compatible' }).epochMilliseconds };
}

export function nextScheduleSlot(spec, index, after = -Infinity) {
  // Binary search jumps over missed occurrences without creating a catch-up burst.
  let first = scheduleSlot(spec, index);
  if (!first || first.at > after) return first;
  let low = index, high = index + 1;
  while (true) { const slot = scheduleSlot(spec, high); if (!slot || slot.at > after) break; low = high; high = index + (high - index) * 2; if (high > 1000000) throw new Error('Recurrence is outside the supported range.'); }
  while (low + 1 < high) { const mid = Math.floor((low + high) / 2), slot = scheduleSlot(spec, mid); if (!slot || slot.at > after) high = mid; else low = mid; }
  return scheduleSlot(spec, high);
}
