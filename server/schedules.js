import crypto from 'node:crypto';
import { prepareNotification, deliverNotification } from './notification-delivery.js';
import { validateSchedule, scheduleSlot, nextScheduleSlot } from './schedule-time.js';

const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const iso = value => value === null || value === undefined ? null : new Date(Number(value)).toISOString();
const publicJob = row => ({ id: row.id, domain_key: row.domain_key, content: decode(row.content), schedule: decode(row.spec), status: row.status,
  next_run_at: iso(row.next_run_ms), created_at: iso(row.created_ms), last_result: row.last_result ? decode(row.last_result) : null, run_count: Number(row.run_count), last_error: row.last_error || '' });
const lockName = 'push-notification-scheduler-v1';
export const scheduleGraceMs = 15 * 60000;

export async function ensureSchedules(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS notification_schedules (
    id CHAR(36) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, domain_key VARCHAR(64) NOT NULL,
    request_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL, content JSON NOT NULL, spec JSON NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active', next_run_ms BIGINT NULL, next_index INT UNSIGNED NOT NULL DEFAULT 0,
    run_count INT UNSIGNED NOT NULL DEFAULT 0, claim_token CHAR(36) NULL, claimed_ms BIGINT NULL,
    created_ms BIGINT NOT NULL, last_result JSON NULL, last_error VARCHAR(255) NULL,
    UNIQUE KEY schedule_request (user_id, domain_key, request_key), KEY schedule_due (status, next_run_ms), KEY schedule_domain (domain_key, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notification_schedule_runs (
    id CHAR(36) PRIMARY KEY, schedule_id CHAR(36) NOT NULL, due_ms BIGINT NOT NULL,
    status VARCHAR(24) NOT NULL, started_ms BIGINT NOT NULL, finished_ms BIGINT NULL,
    result JSON NULL, message VARCHAR(255) NULL, UNIQUE KEY schedule_occurrence (schedule_id, due_ms)
  )`);
  await pool.query('CREATE TABLE IF NOT EXISTS notification_scheduler_state (id INT PRIMARY KEY, heartbeat_ms BIGINT NULL)');
}

export function installSchedules(app, { pool, requireAdmin }) {
  app.get('/api/schedules/status', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const [rows] = await pool.query('SELECT heartbeat_ms FROM notification_scheduler_state WHERE id = 1'); const heartbeat = Number(rows[0]?.heartbeat_ms || 0); return res.json({ ok: true, data: { running: heartbeat > Date.now() - 90000, heartbeat_at: heartbeat ? iso(heartbeat) : null, server_time: iso(Date.now()) } }); }
    catch { return res.status(503).json({ ok: false, message: 'Scheduler status is unavailable.' }); }
  });
  app.post('/api/schedules/preview', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const spec = validateSchedule(req.body?.schedule); return res.json({ ok: true, data: { schedule: spec, upcoming: [0, 1, 2].map(index => scheduleSlot(spec, index)).filter(Boolean).map(slot => iso(slot.at)) } }); }
    catch (error) { return res.status(400).json({ ok: false, message: error.message }); }
  });
  app.post('/api/schedules', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const input = req.body || {}, { domain_key: key, request_key: requestKey } = input;
    if (typeof key !== 'string' || typeof requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestKey)) return res.status(400).json({ ok: false, message: 'A website and unique scheduling request are required.' });
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ title: input.title, body: input.body, url: input.url, icon: input.icon, banner: input.banner, audience: input.audience, schedule: input.schedule })).digest('hex');
    let connection;
    try {
      connection = await pool.getConnection(); await connection.beginTransaction();
      const [domains] = await connection.query('SELECT domain_name, vapid_public_key, vapid_private_key FROM domains WHERE domain_key = ? AND user_id = 1 FOR UPDATE', [key]);
      if (!domains.length) { await connection.rollback(); return res.status(404).json({ ok: false, message: 'Website not found.' }); }
      const [existing] = await connection.query('SELECT * FROM notification_schedules WHERE user_id = 1 AND domain_key = ? AND request_key = ?', [key, requestKey]);
      if (existing.length) {
        await connection.commit();
        if (existing[0].request_hash !== requestHash) return res.status(409).json({ ok: false, message: 'This scheduling request was already used for different content.' });
        return res.json({ ok: true, data: publicJob(existing[0]), message: 'This notification is already scheduled. No duplicate was created.' });
      }
      if (!domains[0].vapid_public_key || !domains[0].vapid_private_key) throw new Error('Configure push keys for this website first.');
      if (!Object.hasOwn(input.audience || {}, 'platform') || !Object.hasOwn(input.audience || {}, 'subscribed')) throw new Error('Choose the audience platform and subscription period.');
      const spec = validateSchedule(input.schedule), prepared = prepareNotification(input, domains[0]);
      const id = crypto.randomUUID(), now = Date.now(), slot = scheduleSlot(spec, 0);
      await connection.query('INSERT INTO notification_schedules (id, user_id, domain_key, request_key, request_hash, content, spec, next_run_ms, created_ms) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)', [id, key, requestKey, requestHash, JSON.stringify(prepared.content), JSON.stringify(spec), slot.at, now]);
      const [rows] = await connection.query('SELECT * FROM notification_schedules WHERE id = ?', [id]); await connection.commit();
      return res.status(201).json({ ok: true, data: publicJob(rows[0]), message: 'Notification scheduled. You can close the dashboard; the backend will send it.' });
    } catch (error) {
      if (connection) await connection.rollback();
      const database = Boolean(error.code);
      return res.status(database ? 503 : 400).json({ ok: false, message: database ? 'Could not save this schedule. Check Schedule List before retrying.' : error.message });
    } finally { connection?.release(); }
  });
  app.get('/api/domains/:key/schedules', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000) return res.status(400).json({ ok: false, message: 'Choose a valid page.' });
    try {
      const [owned] = await pool.query('SELECT domain_key FROM domains WHERE domain_key = ? AND user_id = 1', [req.params.key]);
      if (!owned.length) return res.status(404).json({ ok: false, message: 'Website not found.' });
      const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM notification_schedules WHERE domain_key = ? AND user_id = 1', [req.params.key]);
      const [rows] = await pool.query('SELECT * FROM notification_schedules WHERE domain_key = ? AND user_id = 1 ORDER BY created_ms DESC, id LIMIT 50 OFFSET ?', [req.params.key, (page - 1) * 50]);
      return res.json({ ok: true, data: { rows: rows.map(publicJob), total: Number(count.total), page, pages: Math.max(1, Math.ceil(Number(count.total) / 50)) } });
    } catch { return res.status(503).json({ ok: false, message: 'Could not load schedules.' }); }
  });
  app.get('/api/schedules/:id/runs', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const [rows] = await pool.query('SELECT id FROM notification_schedules WHERE id = ? AND user_id = 1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Schedule not found.' });
      const [runs] = await pool.query('SELECT due_ms, status, started_ms, finished_ms, result, message FROM notification_schedule_runs WHERE schedule_id = ? ORDER BY due_ms DESC LIMIT 20', [req.params.id]);
      return res.json({ ok: true, data: runs.map(run => ({ ...run, due_at: iso(run.due_ms), started_at: iso(run.started_ms), finished_at: iso(run.finished_ms), result: run.result ? decode(run.result) : null })) });
    } catch { return res.status(503).json({ ok: false, message: 'Could not load schedule history.' }); }
  });
  app.patch('/api/schedules/:id', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const action = req.body?.action;
    if (!['pause', 'resume', 'cancel'].includes(action)) return res.status(400).json({ ok: false, message: 'Choose Pause, Resume, or Cancel.' });
    let connection;
    try {
      connection = await pool.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM notification_schedules WHERE id = ? AND user_id = 1 FOR UPDATE', [req.params.id]);
      if (!rows.length) { await connection.rollback(); return res.status(404).json({ ok: false, message: 'Schedule not found.' }); }
      const job = rows[0], spec = decode(job.spec);
      if (job.status === 'running') { await connection.rollback(); return res.status(409).json({ ok: false, message: 'A send is in progress. Try again after it finishes.' }); }
      if (['completed', 'cancelled', 'missed'].includes(job.status)) throw new Error('This schedule has already finished. Create a new schedule to send again.');
      let next = null, status;
      if (action === 'resume') {
        if (!['paused', 'needs_review'].includes(job.status)) throw new Error('Only paused schedules can be resumed.');
        next = nextScheduleSlot(spec, Number(job.next_index), Date.now() + 1000);
        if (!next) throw new Error('No future occurrences remain. Review the send history before creating a new schedule.');
        status = 'active';
      } else if (action === 'pause') { if (job.status !== 'active') throw new Error('Only active schedules can be paused.'); status = 'paused'; }
      else status = 'cancelled';
      await connection.query('UPDATE notification_schedules SET status = ?, next_run_ms = ?, next_index = ?, last_error = NULL WHERE id = ?', [status, action === 'pause' ? job.next_run_ms : next?.at || null, next?.index ?? job.next_index, job.id]);
      await connection.commit(); return res.json({ ok: true, message: action === 'resume' ? 'Schedule resumed at its next future occurrence.' : action === 'pause' ? 'Schedule paused.' : 'Schedule cancelled.' });
    } catch (error) { if (connection) await connection.rollback(); return res.status(error.code ? 503 : 400).json({ ok: false, message: error.code ? 'Could not update this schedule.' : error.message }); }
    finally { connection?.release(); }
  });
}

export function createScheduleWorker({ pool, webpush, vapidSubject, reporting, now = Date.now, logger = console }) {
  let busy = false, stopped = false, timer;
  const tick = async () => {
    if (busy || stopped) return; busy = true;
    let connection, locked = false;
    try {
      connection = await pool.getConnection();
      const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      if (!Number(lock.acquired)) return;
      locked = true;
      const heartbeat = () => connection.query('INSERT INTO notification_scheduler_state (id, heartbeat_ms) VALUES (1, ?) ON DUPLICATE KEY UPDATE heartbeat_ms = VALUES(heartbeat_ms)', [now()]);
      await heartbeat();
      await reporting?.recover();
      // A prior process held the lock while sending. Its disappearance leaves an
      // uncertain occurrence: retain it for review, never automatically resend.
      await connection.query("UPDATE notification_schedule_runs r JOIN notification_schedules j ON j.id = r.schedule_id SET r.status = 'interrupted', r.finished_ms = ?, r.message = 'Send interrupted; some notifications may have been accepted. No automatic retry.' WHERE j.user_id = 1 AND j.status = 'running' AND r.status = 'sending'", [now()]);
      await connection.query("UPDATE notification_schedules SET status = 'needs_review', next_run_ms = NULL, last_error = 'Send interrupted; review history before scheduling again.' WHERE user_id = 1 AND status = 'running'");
      for (let n = 0; n < 10 && !stopped; n++) {
        await connection.beginTransaction();
        const [rows] = await connection.query("SELECT j.* FROM notification_schedules j INNER JOIN domains d ON d.domain_key = j.domain_key AND d.user_id = j.user_id WHERE j.user_id = 1 AND j.status = 'active' AND j.next_run_ms <= ? ORDER BY j.next_run_ms, j.id LIMIT 1 FOR UPDATE", [now()]);
        if (!rows.length) { await connection.commit(); break; }
        const job = rows[0], spec = decode(job.spec), runId = crypto.randomUUID(), due = Number(job.next_run_ms), index = Number(job.next_index);
        const late = now() - due > scheduleGraceMs;
        if (late) {
          const next = nextScheduleSlot(spec, index + 1, now());
          await connection.query("INSERT INTO notification_schedule_runs (id, schedule_id, due_ms, status, started_ms, finished_ms, message) VALUES (?, ?, ?, 'skipped', ?, ?, 'Missed occurrence skipped after the 15-minute grace period; no catch-up burst.')", [runId, job.id, due, now(), now()]);
          await connection.query('UPDATE notification_schedules SET status = ?, next_run_ms = ?, next_index = ?, last_error = ? WHERE id = ?', [next ? 'active' : spec.kind === 'once' ? 'missed' : 'completed', next?.at || null, next?.index ?? index + 1, 'Missed occurrence skipped; check history.', job.id]);
          await connection.commit(); continue;
        }
        const claim = crypto.randomUUID();
        await connection.query("INSERT INTO notification_schedule_runs (id, schedule_id, due_ms, status, started_ms) VALUES (?, ?, ?, 'sending', ?)", [runId, job.id, due, now()]);
        await connection.query("UPDATE notification_schedules SET status = 'running', claim_token = ?, claimed_ms = ?, next_index = ?, run_count = run_count + 1 WHERE id = ?", [claim, now(), index + 1, job.id]);
        await connection.commit();
        try {
          const assertClaim = async () => {
            const [[held]] = await connection.query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS held', [lockName]);
            if (!Number(held.held)) throw new Error('Scheduler lock lost.');
            const [current] = await connection.query("SELECT d.domain_name, d.vapid_public_key, d.vapid_private_key FROM notification_schedules j INNER JOIN domains d ON d.domain_key = j.domain_key AND d.user_id = j.user_id WHERE j.id = ? AND j.status = 'running' AND j.claim_token = ?", [job.id, claim]);
            if (!current.length) throw new Error('Schedule no longer owns this send.');
            await heartbeat(); return current[0];
          };
          const domain = await assertClaim();
          const prepared = prepareNotification(decode(job.content), domain, new Date(now()));
          const result = await deliverNotification({ pool, webpush, vapidSubject, reporting }, domain, job.domain_key, prepared, { source: 'scheduled', scheduleRunId: runId, beforeBatch: assertClaim,
            onProgress: counts => connection.query('UPDATE notification_schedule_runs SET result = ? WHERE id = ?', [JSON.stringify(counts), runId]) });
          await assertClaim();
          const next = nextScheduleSlot(spec, index + 1, now());
          await connection.beginTransaction();
          await connection.query('UPDATE notification_schedule_runs SET status = ?, finished_ms = ?, result = ?, message = ? WHERE id = ?', [result.failed ? result.sent ? 'partial' : 'failed' : 'completed', now(), JSON.stringify(result), result.message.slice(0, 255), runId]);
          await connection.query("UPDATE notification_schedules SET status = ?, next_run_ms = ?, next_index = ?, last_result = ?, last_error = NULL, claim_token = NULL WHERE id = ? AND status = 'running' AND claim_token = ?", [next ? 'active' : 'completed', next?.at || null, next?.index ?? index + 1, JSON.stringify(result), job.id, claim]);
          await connection.commit();
        } catch {
          await connection.rollback();
          await connection.query("UPDATE notification_schedule_runs SET status = 'interrupted', finished_ms = ?, message = 'Send could not be confirmed; no automatic retry. Review before sending again.' WHERE id = ?", [now(), runId]);
          await connection.query("UPDATE notification_schedules SET status = 'needs_review', next_run_ms = NULL, last_error = 'Send could not be confirmed. Review history; no automatic retry.' WHERE id = ? AND claim_token = ?", [job.id, claim]);
        }
      }
      await heartbeat();
    } catch (error) { try { await connection?.rollback(); } catch { /* Connection may have closed. */ } logger.error('Schedule worker paused:', error.code || 'storage unavailable'); }
    finally {
      if (locked) { try { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { /* Closed connections release their advisory lock. */ } }
      connection?.release(); busy = false;
    }
  };
  return { tick, start() { stopped = false; tick(); timer = setInterval(tick, 10000); timer.unref?.(); }, stop() { stopped = true; clearInterval(timer); }, get busy() { return busy; } };
}
