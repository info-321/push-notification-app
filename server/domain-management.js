export async function deleteOwnedDomain(pool, field, value, userId) {
  if (!['id', 'domain_key'].includes(field)) throw new Error('Unsupported domain identifier');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT id, domain_key FROM domains WHERE ${field} = ? AND user_id = ? FOR UPDATE`, [value, userId]);
    if (!rows.length) { await connection.rollback(); return false; }
    const [running] = await connection.query("SELECT id FROM notification_schedules WHERE domain_key = ? AND user_id = ? AND status = 'running' LIMIT 1", [rows[0].domain_key, userId]);
    if (running.length) throw Object.assign(new Error('A scheduled send is in progress. Try deleting this domain after it finishes.'), { code: 'SCHEDULE_RUNNING' });
    await connection.query('DELETE r FROM notification_schedule_runs r INNER JOIN notification_schedules j ON j.id = r.schedule_id WHERE j.domain_key = ? AND j.user_id = ?', [rows[0].domain_key, userId]);
    await connection.query('DELETE FROM notification_schedules WHERE domain_key = ? AND user_id = ?', [rows[0].domain_key, userId]);
    await connection.query('DELETE FROM subscriptions WHERE domain_key = ? AND user_id = ?', [rows[0].domain_key, userId]);
    await connection.query('DELETE FROM push_images WHERE domain_key = ?', [rows[0].domain_key]);
    await connection.query('DELETE FROM prompt_events WHERE domain_key = ?', [rows[0].domain_key]);
    await connection.query('DELETE FROM domains WHERE id = ? AND user_id = ?', [rows[0].id, userId]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
