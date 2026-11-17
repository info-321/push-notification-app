// Additive storage upgrades. The old endpoint index is removed only after its
// full-value replacement is present. No subscription or credential is rewritten.
export async function ensureStorageMaintenance(pool) {
  const [columns] = await pool.query("SHOW COLUMNS FROM subscriptions LIKE 'endpoint_sha256'");
  if (!columns.length) {
    await pool.query('ALTER TABLE subscriptions ADD COLUMN endpoint_sha256 BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CAST(endpoint AS BINARY),256))) STORED');
  } else if (!columns[0].Extra.includes('STORED GENERATED') || columns[0].Type.toLowerCase() !== 'binary(32)') {
    throw new Error('The endpoint fingerprint column has an unexpected definition. No index was removed.');
  }
  const indexes = [
    ['subscriptions', 'uniq_endpoint_sha256', 'UNIQUE', 'endpoint_sha256'],
    ['subscriptions', 'subscriber_domain_created', '', 'domain_key,user_id,created_at'],
    ['subscriptions', 'subscriber_domain_target', '', 'domain_key,user_id,target_device,target_browser'],
    ['subscriptions', 'subscriber_ip_retention', '', 'ip_recorded_at'],
    ['subscriptions', 'subscriber_gps_retention', '', 'location_recorded_at'],
    ['login_attempts', 'login_ip_period', '', 'ip_address,occurred_ms'],
    ['activity_log', 'activity_period', '', 'occurred_ms'],
    ['prompt_events', 'prompt_retention', '', 'created_at'],
    ['push_campaigns', 'campaign_retention', '', 'finished_ms,id'],
  ];
  for (const [table, name, unique, fields] of indexes) {
    const [existing] = await pool.query(`SHOW INDEX FROM ${table} WHERE Key_name=?`, [name]);
    if (!existing.length) await pool.query(`ALTER TABLE ${table} ADD ${unique} INDEX ${name} (${fields})`);
    else if (existing.map(row => row.Column_name).join(',') !== fields || (unique && existing[0].Non_unique !== 0)) throw new Error(`Unexpected storage index: ${name}`);
  }
  const [old] = await pool.query("SHOW INDEX FROM subscriptions WHERE Key_name='uniq_endpoint'");
  if (old.length) {
    if (old.length !== 1 || old[0].Column_name !== 'endpoint' || Number(old[0].Sub_part) !== 255) throw new Error('Unexpected legacy endpoint index; review it before removal.');
    await pool.query('ALTER TABLE subscriptions DROP INDEX uniq_endpoint');
  }
  for (const [name, type] of [['archived_telemetry', 'JSON NULL'], ['telemetry_archived_ms', 'BIGINT NULL']]) {
    if (!(await pool.query(`SHOW COLUMNS FROM push_campaigns LIKE '${name}'`))[0].length) await pool.query(`ALTER TABLE push_campaigns ADD COLUMN ${name} ${type}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS prompt_daily_totals (
    domain_key VARCHAR(64) NOT NULL, day_number INT NOT NULL, revision CHAR(16) NOT NULL,
    template VARCHAR(16) NOT NULL, device_group VARCHAR(16) NOT NULL,
    views BIGINT UNSIGNED NOT NULL, clicks BIGINT UNSIGNED NOT NULL,
    dismissals BIGINT UNSIGNED NOT NULL, subscriptions BIGINT UNSIGNED NOT NULL,
    first_ms BIGINT NOT NULL,
    PRIMARY KEY(domain_key,day_number,revision,template,device_group))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_runs (
    id CHAR(36) PRIMARY KEY, started_ms BIGINT NOT NULL, finished_ms BIGINT NULL,
    status VARCHAR(16) NOT NULL, policy JSON NOT NULL, result JSON NULL,
    KEY maintenance_started(started_ms))`);
  pool.notizoStorageMaintenance = true;
}

// Keeping the original predicate first preserves the small injectable test
// adapters. Production also checks the indexed binary fingerprint, making URL
// paths case-sensitive even when the database default collation is not.
export const endpointWhere = pool => pool.notizoStorageMaintenance ? 'endpoint = ? AND endpoint_sha256 = UNHEX(SHA2(CAST(? AS BINARY),256))' : 'endpoint = ?';
export const endpointParams = (pool, endpoint) => pool.notizoStorageMaintenance ? [endpoint, endpoint] : [endpoint];
