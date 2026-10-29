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

export async function ensureDomainPwa(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM domains LIKE 'pwa_settings'");
  if (columns.length) return;
  try { await pool.query('ALTER TABLE domains ADD COLUMN pwa_settings JSON NULL'); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
}

export async function ensureSubscriptionCountry(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM subscriptions LIKE 'country_code'");
  if (columns.length) return;
  try { await pool.query('ALTER TABLE subscriptions ADD COLUMN country_code CHAR(2) NULL'); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
}

export async function ensureSubscriptionLocations(pool) {
  for (const [column, type] of [['region_name', 'VARCHAR(128) CHARACTER SET utf8mb4'], ['region_code', 'VARCHAR(16)'], ['city_name', 'VARCHAR(128) CHARACTER SET utf8mb4']]) {
    const [columns] = await pool.query(`SHOW COLUMNS FROM subscriptions LIKE '${column}'`);
    if (columns.length) continue;
    try { await pool.query(`ALTER TABLE subscriptions ADD COLUMN ${column} ${type} NULL`); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }
}

export async function ensureSubscriptionDevice(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM subscriptions LIKE 'device_type'");
  if (columns.length) return;
  try { await pool.query('ALTER TABLE subscriptions ADD COLUMN device_type VARCHAR(16) NULL'); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
}

export async function ensureSubscriptionBrowser(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM subscriptions LIKE 'browser_family'");
  if (columns.length) return;
  try { await pool.query('ALTER TABLE subscriptions ADD COLUMN browser_family VARCHAR(32) NULL'); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
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
