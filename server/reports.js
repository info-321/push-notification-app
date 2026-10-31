import crypto from 'node:crypto';

const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const iso = value => value == null ? null : new Date(Number(value)).toISOString();
export const reportStates = ['sending', 'completed', 'partial', 'failed', 'interrupted'];
export async function ensureReports(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS push_campaigns (
    id CHAR(36) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, domain_key VARCHAR(64) NOT NULL,
    schedule_run_id CHAR(36) NULL, source VARCHAR(16) NOT NULL, is_test BOOLEAN NOT NULL DEFAULT FALSE,
    content JSON NOT NULL, status VARCHAR(24) NOT NULL, tracking BOOLEAN NOT NULL DEFAULT TRUE,
    targeted INT UNSIGNED NULL, accepted INT UNSIGNED NULL, failed INT UNSIGNED NULL, expired INT UNSIGNED NULL,
    created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL, finished_ms BIGINT NULL,
    UNIQUE KEY campaign_schedule (schedule_run_id), KEY campaign_domain (domain_key, user_id, created_ms, id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS push_campaign_recipients (
    id CHAR(32) PRIMARY KEY, campaign_id CHAR(36) NOT NULL, result VARCHAR(16) NOT NULL DEFAULT 'pending',
    acknowledged_ms BIGINT NULL, clicked_ms BIGINT NULL, click_action VARCHAR(16) NULL,
    KEY campaign_recipient (campaign_id)
  )`);
  // Existing schedule runs have acceptance counts, but never had browser telemetry.
  await pool.query(`INSERT IGNORE INTO push_campaigns
    (id, user_id, domain_key, schedule_run_id, source, content, status, tracking, targeted, accepted, failed, expired, created_ms, updated_ms, finished_ms)
    SELECT r.id, j.user_id, j.domain_key, r.id, 'historical', j.content,
      CASE WHEN r.status = 'interrupted' THEN 'interrupted' WHEN r.status = 'partial' THEN 'partial' WHEN r.status = 'failed' THEN 'failed' ELSE 'completed' END,
      FALSE, CASE WHEN JSON_TYPE(JSON_EXTRACT(r.result, '$.total')) = 'INTEGER' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result, '$.total')) AS UNSIGNED) ELSE NULL END, CASE WHEN JSON_TYPE(JSON_EXTRACT(r.result, '$.sent')) = 'INTEGER' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result, '$.sent')) AS UNSIGNED) ELSE NULL END, CASE WHEN JSON_TYPE(JSON_EXTRACT(r.result, '$.failed')) = 'INTEGER' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result, '$.failed')) AS UNSIGNED) ELSE NULL END, CASE WHEN JSON_TYPE(JSON_EXTRACT(r.result, '$.removed')) = 'INTEGER' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(r.result, '$.removed')) AS UNSIGNED) ELSE NULL END,
      r.started_ms, COALESCE(r.finished_ms, r.started_ms), r.finished_ms
    FROM notification_schedule_runs r INNER JOIN notification_schedules j ON j.id = r.schedule_id
    WHERE j.user_id = 1 AND r.status IN ('completed', 'partial', 'failed', 'interrupted')`);
}

export function createCampaignReporter({ pool, secret, publicApiBase, now = Date.now }) {
  const url = `${publicApiBase.replace(/\/$/, '')}/api/report-events`;
  return {
    async recover() { await pool.query("UPDATE push_campaigns SET status = 'interrupted', finished_ms = ? WHERE status = 'sending' AND updated_ms < ?", [now(), now() - 120000]); },
    async begin({ domainKey, content, total, source = 'api', isTest = false, scheduleRunId = null }) {
      const id = crypto.randomUUID();
      const [inserted] = await pool.query("INSERT INTO push_campaigns (id, user_id, domain_key, schedule_run_id, source, is_test, content, status, targeted, accepted, failed, expired, created_ms, updated_ms) SELECT ?, 1, ?, ?, ?, ?, ?, 'sending', ?, 0, 0, 0, ?, ? FROM domains WHERE domain_key = ? AND user_id = 1", [id, domainKey, scheduleRunId, source, isTest, JSON.stringify(content), total, now(), now(), domainKey]);
      if (inserted.affectedRows !== 1) throw new Error('The website is no longer available.');
      const update = async (counts, status, finished) => pool.query('UPDATE push_campaigns SET accepted = ?, failed = ?, expired = ?, status = ?, updated_ms = ?, finished_ms = ? WHERE id = ?', [counts.sent, counts.failed, counts.removed, status, now(), finished ? now() : null, id]);
      return {
        id,
        async recipient() {
          const recipient = crypto.randomBytes(16).toString('hex'), expires = Math.floor(now() / 1000) + 90 * 86400;
          const value = `${id}.${recipient}.${expires}`;
          const signature = crypto.createHmac('sha256', secret).update(`report:${value}`).digest('base64url');
          await pool.query('INSERT INTO push_campaign_recipients (id, campaign_id) VALUES (?, ?)', [recipient, id]);
          return { id: recipient, tracking: { url, token: `${value}.${signature}` } };
        },
        async result(recipient, result) { await pool.query('UPDATE push_campaign_recipients SET result = ? WHERE id = ? AND campaign_id = ?', [result, recipient, id]); },
        progress: counts => update(counts, 'sending', false),
        finish: counts => update(counts, counts.failed ? counts.sent ? 'partial' : 'failed' : 'completed', true),
        interrupt: counts => update(counts, 'interrupted', true),
      };
    },
  };
}

export function verifyReportToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 240) return null;
  const [campaign, recipient, expires, signature, extra] = token.split('.');
  if (extra || !/^[a-f0-9-]{36}$/.test(campaign || '') || !/^[a-f0-9]{32}$/.test(recipient || '') || !/^\d{10}$/.test(expires || '') || Number(expires) * 1000 < now) return null;
  const expected = crypto.createHmac('sha256', secret).update(`report:${campaign}.${recipient}.${expires}`).digest('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature || '') || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { campaign, recipient };
}

const projection = row => { const accepted = row.tracking ? Math.max(Number(row.accepted || 0), Number(row.recipient_accepted || 0)) : row.accepted; return ({ id: row.id, domain_key: row.domain_key, source: row.source, is_test: Boolean(row.is_test), content: decode(row.content),
  status: row.status, tracking: Boolean(row.tracking), targeted: row.targeted, accepted, failed: row.failed, expired: row.expired,
  acknowledged: row.tracking ? Number(row.acknowledged || 0) : null, clicks: row.tracking ? Number(row.clicks || 0) : null,
  click_rate: row.tracking && Number(accepted) > 0 ? Number(row.accepted_clicks || 0) / Number(accepted) * 100 : null,
  sent_at: iso(row.created_ms), finished_at: iso(row.finished_ms) }); };
const selectCampaigns = `SELECT c.*,
  (SELECT COUNT(*) FROM push_campaign_recipients r WHERE r.campaign_id = c.id AND r.result = 'accepted') AS recipient_accepted,
  (SELECT COUNT(*) FROM push_campaign_recipients r WHERE r.campaign_id = c.id AND r.acknowledged_ms IS NOT NULL) AS acknowledged,
  (SELECT COUNT(*) FROM push_campaign_recipients r WHERE r.campaign_id = c.id AND r.clicked_ms IS NOT NULL) AS clicks,
  (SELECT COUNT(*) FROM push_campaign_recipients r WHERE r.campaign_id = c.id AND r.clicked_ms IS NOT NULL AND r.result = 'accepted') AS accepted_clicks
  FROM push_campaigns c`;
export function reportFilter(key, query) {
  const params = [key], clauses = ['c.domain_key = ?', 'c.user_id = 1'];
  if (query.q) { if (typeof query.q !== 'string' || query.q.length > 150) throw new Error('Search titles using up to 150 characters.'); clauses.push("LOCATE(?, JSON_UNQUOTE(JSON_EXTRACT(c.content, '$.title'))) > 0"); params.push(query.q); }
  const dates = [];
  for (const field of ['from', 'to']) {
    if (!query[field]) { dates.push(null); continue; }
    const value = query[field];
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Choose valid date filters.');
    dates.push(Date.parse(value));
  }
  if (dates[0] !== null && dates[1] !== null && dates[0] > dates[1]) throw new Error('The end date must follow the start date.');
  if (dates[0] !== null) { clauses.push('c.created_ms >= ?'); params.push(dates[0]); }
  if (dates[1] !== null) { clauses.push('c.created_ms < ?'); params.push(dates[1] + 86400000); }
  if (query.status && query.status !== 'all') { if (!reportStates.includes(query.status)) throw new Error('Choose a valid campaign status.'); clauses.push('c.status = ?'); params.push(query.status); }
  if (!['hide', 'only', 'include', undefined].includes(query.tests)) throw new Error('Choose a valid test filter.');
  if (query.tests !== 'include') { clauses.push('c.is_test = ?'); params.push(query.tests === 'only' ? 1 : 0); }
  return { sql: clauses.join(' AND '), params };
}
export const csvCell = value => {
  let text = value == null ? 'Not tracked' : String(value);
  if (/^[\s]*[=+@\-]|^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

export function installReports(app, { pool, secret, requireAdmin }) {
  app.post('/api/report-events', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const claims = verifyReportToken(req.body?.token, secret), event = req.body?.event, action = req.body?.action || 'body';
    if (!claims || !['ack', 'click'].includes(event) || !['body', 'button-1', 'button-2'].includes(action)) return res.status(400).json({ ok: false, message: 'Invalid report event.' });
    try {
      const [rows] = await pool.query('SELECT d.domain_name FROM push_campaigns c INNER JOIN domains d ON d.domain_key = c.domain_key AND d.user_id = c.user_id WHERE c.id = ? AND c.user_id = 1 AND c.tracking = TRUE', [claims.campaign]);
      let origin; try { origin = new URL(req.get('Origin')); } catch { /* Reject missing origins. */ }
      if (!rows.length || !origin || origin.protocol !== 'https:' || origin.port || origin.hostname.replace(/^www\./, '') !== rows[0].domain_name.replace(/^www\./, '')) return res.status(403).json({ ok: false, message: 'This event does not match the website.' });
      if (event === 'ack') await pool.query('UPDATE push_campaign_recipients SET acknowledged_ms = COALESCE(acknowledged_ms, ?) WHERE id = ? AND campaign_id = ?', [Date.now(), claims.recipient, claims.campaign]);
      else await pool.query('UPDATE push_campaign_recipients SET click_action = IF(clicked_ms IS NULL, ?, click_action), clicked_ms = COALESCE(clicked_ms, ?) WHERE id = ? AND campaign_id = ?', [action, Date.now(), claims.recipient, claims.campaign]);
      return res.json({ ok: true });
    } catch { return res.status(503).json({ ok: false, message: 'Reporting is temporarily unavailable.' }); }
  });
  const owned = async key => (await pool.query('SELECT domain_key FROM domains WHERE domain_key = ? AND user_id = 1', [key]))[0].length > 0;
  app.get('/api/domains/:key/reports', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let filter, page, limit;
    try { filter = reportFilter(req.params.key, req.query); page = Number(req.query.page || 1); limit = Number(req.query.limit || 20); if (!Number.isInteger(page) || page < 1 || page > 100000 || ![5, 20].includes(limit)) throw new Error('Choose a valid reports page.'); }
    catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
    try {
      if (!await owned(req.params.key)) return res.status(404).json({ ok: false, message: 'Website not found.' });
      const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM push_campaigns c WHERE ${filter.sql}`, filter.params);
      const [rows] = await pool.query(`${selectCampaigns} WHERE ${filter.sql} ORDER BY c.created_ms DESC, c.id DESC LIMIT ? OFFSET ?`, [...filter.params, limit, (page - 1) * limit]);
      return res.json({ ok: true, data: { rows: rows.map(projection), total: Number(count.total), page, pages: Math.max(1, Math.ceil(count.total / limit)) } });
    } catch { return res.status(503).json({ ok: false, message: 'Could not load campaign reports.' }); }
  });
  app.get('/api/domains/:key/reports/export', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let filter; try { filter = reportFilter(req.params.key, req.query); } catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
    try {
      if (!await owned(req.params.key)) return res.status(404).json({ ok: false, message: 'Website not found.' });
      res.type('text/csv').set('Content-Disposition', 'attachment; filename="push-reports.csv"');
      const write = async chunk => {
        if (res.destroyed || res.write(chunk)) return;
        await new Promise(resolve => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); });
      };
      await write('\uFEFF' + ['Sent (UTC)', 'Title', 'Message', 'URL', 'Source', 'Test', 'Status', 'Platform', 'Subscription period', 'Targeted', 'Accepted', 'Failed', 'Expired', 'Browser acknowledgements', 'Unique clicks', 'Click rate (%)'].map(csvCell).join(',') + '\r\n');
      let cursor = null;
      while (!res.destroyed) {
        const [rows] = await pool.query(`${selectCampaigns} WHERE ${filter.sql}${cursor ? ' AND (c.created_ms < ? OR (c.created_ms = ? AND c.id < ?))' : ''} ORDER BY c.created_ms DESC, c.id DESC LIMIT 500`, [...filter.params, ...(cursor ? [cursor.created_ms, cursor.created_ms, cursor.id] : [])]);
        if (!rows.length) break;
        for (const raw of rows) { if (res.destroyed) break; const c = projection(raw); await write([c.sent_at, c.content.title, c.content.body, c.content.url, c.source, c.is_test, c.status, c.content.audience?.platform || 'all', c.content.audience?.subscribed || 'all', c.targeted, c.accepted, c.failed, c.expired, c.acknowledged, c.clicks, c.click_rate?.toFixed(2)].map(csvCell).join(',') + '\r\n'); }
        cursor = rows.at(-1); if (rows.length < 500) break;
      }
      res.end();
    } catch { if (res.headersSent) res.destroy(); else res.status(503).json({ ok: false, message: 'Could not export reports.' }); }
  });
  app.get('/api/domains/:key/reports/:id', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [rows] = await pool.query(`${selectCampaigns} INNER JOIN domains d ON d.domain_key = c.domain_key AND d.user_id = c.user_id WHERE c.id = ? AND c.domain_key = ? AND c.user_id = 1`, [req.params.id, req.params.key]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Campaign not found.' });
      return res.json({ ok: true, data: projection(rows[0]) });
    } catch { return res.status(503).json({ ok: false, message: 'Could not load this campaign.' }); }
  });
}
