export async function deleteOwnedDomain(pool, field, value, userId) {
  if (!['id', 'domain_key'].includes(field)) throw new Error('Unsupported domain identifier');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT id, domain_key FROM domains WHERE ${field} = ? AND user_id = ? FOR UPDATE`, [value, userId]);
    if (!rows.length) { await connection.rollback(); return false; }
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
