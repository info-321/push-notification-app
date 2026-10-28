// Additive startup migration: older deployments only stored the hostname.
// Keeping the new column nullable lets older app images continue to run.
export async function ensureDomainDisplayName(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM domains LIKE 'display_name'");
  if (columns.length) return;
  try {
    await pool.query('ALTER TABLE domains ADD COLUMN display_name VARCHAR(255) NULL AFTER domain_name');
  } catch (error) {
    // Another API instance may have completed the same migration first.
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}

export async function ensureDomainTimeZone(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM domains LIKE 'time_zone'");
  if (columns.length) return;
  try {
    await pool.query('ALTER TABLE domains ADD COLUMN time_zone VARCHAR(64) NULL');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}
