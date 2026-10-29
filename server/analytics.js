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
      const [rows] = await pool.query(`SELECT FLOOR(UNIX_TIMESTAMP(created_at) / 86400) AS day_number, COUNT(*) AS subscribers
        FROM subscriptions WHERE domain_key = ? AND user_id = ?
        AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''
        AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)
        GROUP BY day_number ORDER BY day_number`, [req.params.key, domains[0].user_id, range.first.getTime() / 1000, range.afterLast.getTime() / 1000]);
      const counts = new Map(rows.map(row => [Number(row.day_number), Number(row.subscribers)]));
      const daily = [];
      for (let timestamp = range.first.getTime(); timestamp < range.afterLast.getTime(); timestamp += dayMs) daily.push({ date: new Date(timestamp).toISOString().slice(0, 10), added: counts.get(timestamp / dayMs) || 0 });
      return res.json({ ok: true, data: {
        range: { start: range.start, end: range.end, time_zone: 'UTC' }, daily,
        added: daily.reduce((total, day) => total + day.added, 0),
        mobile: null, desktop: null, app: null, unsubscribed: null, net: null,
        browser: { available: false, rows: [] },
        basis: 'Currently saved subscription records created during this period. Removal history and browser/device metadata were not recorded.',
      } });
    } catch (error) {
      console.error('Analytics lookup failed:', error.code);
      return res.status(500).json({ ok: false, message: 'Could not load subscriber analytics. Please try again.' });
    }
  });
}
