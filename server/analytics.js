import { browserFamilies, deviceCountSql, summarizeDevices } from './subscriber-device.js';

const dayMs = 86400000;

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1970-01-01') return null;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function analyticsRange(query, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const start = query.start === undefined && query.end === undefined ? today.slice(0, 8) + '01' : query.start;
  const end = query.start === undefined && query.end === undefined ? today : query.end;
  const first = parseDate(start), last = parseDate(end);
  if (!first || !last || first > last || end > today || (last - first) / dayMs >= 366) return null;
  return { start, end, first, afterLast: new Date(last.getTime() + dayMs) };
}

export function installAnalytics(app, pool) {
  // The /api/domains administrator middleware protects the records and aggregates.
  app.get('/api/domains/:key/analytics', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const range = analyticsRange(req.query);
    if (!range) return res.status(400).json({ ok: false, message: 'Choose valid dates from the past or today, in order, spanning at most 366 days.' });
    try {
      const [domains] = await pool.query('SELECT user_id FROM domains WHERE domain_key = ? AND user_id = ?', [req.params.key, 1]);
      if (!domains.length) return res.status(404).json({ ok: false, message: 'Domain not found.' });
      // TIMESTAMP -> epoch makes UTC grouping independent of MySQL session zone.
      const [rows] = await pool.query(`SELECT FLOOR(UNIX_TIMESTAMP(created_at) / 86400) AS day_number, browser_family, COUNT(*) AS subscribers, ${deviceCountSql}
        FROM subscriptions WHERE domain_key = ? AND user_id = ?
        AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''
        AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)
        GROUP BY day_number, browser_family ORDER BY day_number`, [req.params.key, domains[0].user_id, range.first.getTime() / 1000, range.afterLast.getTime() / 1000]);
      const counts = new Map(), browsers = new Map();
      let browserUnknown = 0;
      for (const row of rows) {
        const day = Number(row.day_number), combined = counts.get(day) || { subscribers: 0, desktop: 0, mobile: 0 };
        for (const key of ['subscribers', 'desktop', 'mobile']) combined[key] += Number(row[key] || 0);
        counts.set(day, combined);
        if (browserFamilies.includes(row.browser_family)) browsers.set(row.browser_family, (browsers.get(row.browser_family) || 0) + Number(row.subscribers));
        else browserUnknown += Number(row.subscribers);
      }
      const daily = [];
      for (let timestamp = range.first.getTime(); timestamp < range.afterLast.getTime(); timestamp += dayMs) {
        const row = counts.get(timestamp / dayMs) || {};
        const devices = summarizeDevices(row);
        daily.push({ date: new Date(timestamp).toISOString().slice(0, 10), added: Number(row.subscribers || 0),
          desktop: devices.desktop || 0, mobile: devices.mobile || 0, device_unknown: devices.device_unknown });
      }
      const totals = daily.reduce((sum, day) => ({ subscribers: sum.subscribers + day.added, desktop: sum.desktop + day.desktop, mobile: sum.mobile + day.mobile }), { subscribers: 0, desktop: 0, mobile: 0 });
      return res.json({ ok: true, data: {
        range: { start: range.start, end: range.end, time_zone: 'UTC' }, daily,
        added: totals.subscribers, ...summarizeDevices(totals),
        app: null, unsubscribed: null, net: null,
        browser: { available: browserUnknown < totals.subscribers || totals.subscribers === 0,
          total: totals.subscribers, recorded: totals.subscribers - browserUnknown, unknown: browserUnknown,
          rows: browserFamilies.filter(name => browsers.has(name)).map(name => ({ name, subscribers: browsers.get(name) })) },
        basis: 'Currently saved subscription records created during this period. Browser and device categories are approximate and update when subscribed browsers revisit. Removal history is not recorded.',
      } });
    } catch (error) {
      console.error('Analytics lookup failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load subscriber analytics. Please try again.' });
    }
  });
}
