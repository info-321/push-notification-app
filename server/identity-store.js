import crypto from 'node:crypto';

export async function ensureIdentity(pool) {
  const [ids] = await pool.query("SHOW COLUMNS FROM admin_accounts LIKE 'id'");
  if (!ids[0].Extra.includes('auto_increment')) await pool.query('ALTER TABLE admin_accounts MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
  for (const [name, type] of [['role', "VARCHAR(16) NOT NULL DEFAULT 'admin'"], ['is_active', 'BOOLEAN NOT NULL DEFAULT TRUE'], ['access_version', 'INT NOT NULL DEFAULT 1'], ['legacy_deadline_ms', 'BIGINT NULL']]) {
    const [rows] = await pool.query(`SHOW COLUMNS FROM admin_accounts LIKE '${name}'`);
    if (!rows.length) { try { await pool.query(`ALTER TABLE admin_accounts ADD COLUMN ${name} ${type}`); } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; } }
  }
  await pool.query('UPDATE admin_accounts SET legacy_deadline_ms = ? WHERE legacy_deadline_ms IS NULL', [Date.now() + 12 * 3600000]);
  const [unique] = await pool.query("SHOW INDEX FROM admin_accounts WHERE Key_name='unique_dashboard_username'");
  if (!unique.length) {try{await pool.query('ALTER TABLE admin_accounts ADD UNIQUE KEY unique_dashboard_username (username)');}catch(error){if(error.code!=='ER_DUP_KEYNAME')throw error;}}
  await pool.query(`CREATE TABLE IF NOT EXISTS user_domain_access (user_id BIGINT UNSIGNED NOT NULL, domain_key VARCHAR(64) NOT NULL, PRIMARY KEY(user_id,domain_key))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id CHAR(36) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, token_hash CHAR(64) NOT NULL,
    login_ms BIGINT NOT NULL, last_seen_ms BIGINT NOT NULL, expires_ms BIGINT NOT NULL,
    ip_address VARCHAR(45) NULL, device VARCHAR(32) NULL, browser VARCHAR(32) NULL, os VARCHAR(32) NULL,
    ended_ms BIGINT NULL, end_reason VARCHAR(24) NULL, source VARCHAR(24) NOT NULL DEFAULT 'interactive',
    auth_transport VARCHAR(12) NOT NULL DEFAULT 'legacy',
    KEY session_user(user_id,login_ms), KEY session_expiry(expires_ms))`);
  if(!(await pool.query("SHOW COLUMNS FROM dashboard_sessions LIKE 'auth_transport'"))[0].length)await pool.query("ALTER TABLE dashboard_sessions ADD COLUMN auth_transport VARCHAR(12) NOT NULL DEFAULT 'legacy'");
  await pool.query("UPDATE dashboard_sessions SET ended_ms=?,end_reason='cookie_upgrade' WHERE auth_transport='legacy' AND source<>'deployment' AND ended_ms IS NULL AND expires_ms>?",[Date.now(),Date.now()]);
  await pool.query(`CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(255) NOT NULL, user_id BIGINT UNSIGNED NULL,
    succeeded BOOLEAN NOT NULL, occurred_ms BIGINT NOT NULL, ip_address VARCHAR(45) NULL,
    device VARCHAR(32) NULL, browser VARCHAR(32) NULL, os VARCHAR(32) NULL,
    KEY login_period(occurred_ms), KEY login_rate(username,occurred_ms))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_log (
    id CHAR(36) PRIMARY KEY, actor_id BIGINT UNSIGNED NOT NULL, actor_name VARCHAR(255) NOT NULL,
    domain_key VARCHAR(64) NULL, action VARCHAR(128) NOT NULL, method VARCHAR(8) NOT NULL,
    occurred_ms BIGINT NOT NULL, finished_ms BIGINT NULL, http_status INT NULL,
    KEY activity_actor(actor_id,occurred_ms), KEY activity_domain(domain_key,occurred_ms))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notification_drafts (
    user_id BIGINT UNSIGNED NOT NULL, domain_key VARCHAR(64) NOT NULL, version INT NOT NULL,
    content JSON NOT NULL, updated_ms BIGINT NOT NULL, PRIMARY KEY(user_id,domain_key))`);
  pool.notizoIdentity=true;
}
export const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const userFields = 'id, username, password_hash, session_version, password_changed_at, last_login_at, last_login_ip, role, is_active, access_version, legacy_deadline_ms';
export function mysqlIdentityStore(pool) {
  return {
    async find(username) { return (await pool.query(`SELECT ${userFields} FROM admin_accounts WHERE username = ? LIMIT 1`, [username]))[0][0]; },
    async permissions(id) { return (await pool.query('SELECT domain_key FROM user_domain_access WHERE user_id = ?', [id]))[0].map(row => row.domain_key); },
    async users() { return (await pool.query(`SELECT ${userFields} FROM admin_accounts ORDER BY id`))[0]; },
    async createUser(input) {
      const c = await pool.getConnection();
      try { await c.beginTransaction();
        const [exists] = await c.query('SELECT id FROM admin_accounts WHERE username = ? FOR UPDATE', [input.username]);
        if (exists.length) throw Object.assign(new Error('Username already exists.'), { status: 409 });
        const [result] = await c.query('INSERT INTO admin_accounts (username,password_hash,session_version,role,legacy_deadline_ms) VALUES (?,?,?,?,0)', [input.username,input.password_hash,crypto.randomBytes(24).toString('hex'),input.role]);
        for (const key of input.domains) await c.query('INSERT INTO user_domain_access (user_id,domain_key) VALUES (?,?)', [result.insertId,key]);
        await c.commit(); return result.insertId;
      } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
    },
    async updateUser(id, input) {
      const c = await pool.getConnection();
      try { await c.beginTransaction();
        const [r] = await c.query('UPDATE admin_accounts SET role=?,is_active=?,access_version=access_version+1,session_version=? WHERE id=? AND access_version=? AND id<>1', [input.role,input.is_active,crypto.randomBytes(24).toString('hex'),id,input.version]);
        if (!r.affectedRows) { await c.rollback(); return false; }
        await c.query('DELETE FROM user_domain_access WHERE user_id=?', [id]);
        for (const key of input.domains) await c.query('INSERT INTO user_domain_access (user_id,domain_key) VALUES (?,?)', [id,key]);
        await c.query("UPDATE dashboard_sessions SET ended_ms=?,end_reason='access_changed' WHERE user_id=? AND ended_ms IS NULL AND expires_ms>?", [Date.now(),id,Date.now()]);
        await c.commit(); return true;
      } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
    },
    async startSession(row) { await pool.query('INSERT INTO dashboard_sessions (id,user_id,token_hash,login_ms,last_seen_ms,expires_ms,ip_address,device,browser,os,auth_transport) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [row.id,row.user_id,row.token_hash,row.login_ms,row.login_ms,row.expires_ms,row.ip_address,row.device,row.browser,row.os,row.auth_transport||'legacy']); },
    async session(id) { return (await pool.query('SELECT * FROM dashboard_sessions WHERE id=?', [id]))[0][0]; },
    async touch(id) { await pool.query('UPDATE dashboard_sessions SET last_seen_ms=? WHERE id=? AND last_seen_ms<? AND ended_ms IS NULL', [Date.now(),id,Date.now()-60000]); },
    async endSession(id, userId, reason='logout') { return (await pool.query('UPDATE dashboard_sessions SET ended_ms=?,end_reason=? WHERE id=? AND user_id=? AND ended_ms IS NULL AND expires_ms>?', [Date.now(),reason,id,userId,Date.now()]))[0].affectedRows > 0; },
    async endOthers(userId, except, reason='revoked') {
      await pool.query('UPDATE admin_accounts SET legacy_deadline_ms=0 WHERE id=?',[userId]);
      await pool.query('UPDATE dashboard_sessions SET ended_ms=?,end_reason=? WHERE user_id=? AND id<>? AND ended_ms IS NULL AND expires_ms>?', [Date.now(),reason,userId,except || '',Date.now()]);
    },
    async sessions(userId, offset=0) { return (await pool.query('SELECT * FROM dashboard_sessions WHERE user_id=? ORDER BY login_ms DESC LIMIT 50 OFFSET ?', [userId,offset]))[0]; },
    async attempt(row) { await pool.query('INSERT INTO login_attempts (username,user_id,succeeded,occurred_ms,ip_address,device,browser,os) VALUES (?,?,?,?,?,?,?,?)', [row.username,row.user_id || null,row.succeeded,Date.now(),row.ip_address,row.device,row.browser,row.os]); },
    async failures(username, ip) { return Number((await pool.query('SELECT COUNT(*) AS n FROM login_attempts WHERE succeeded=FALSE AND occurred_ms>? AND (username=? OR (ip_address IS NOT NULL AND ip_address=?))', [Date.now()-900000,username,ip]))[0][0].n); },
    async attempts(offset=0) { return (await pool.query('SELECT id,username,user_id,succeeded,occurred_ms,ip_address,device,browser,os FROM login_attempts ORDER BY id DESC LIMIT 50 OFFSET ?', [offset]))[0]; },
    async audit(row) { const id=crypto.randomUUID(); await pool.query('INSERT INTO activity_log (id,actor_id,actor_name,domain_key,action,method,occurred_ms) VALUES (?,?,?,?,?,?,?)', [id,row.actor_id,row.actor_name,row.domain_key,row.action,row.method,Date.now()]); return id; },
    async finishAudit(id, status) { await pool.query('UPDATE activity_log SET finished_ms=?,http_status=? WHERE id=?', [Date.now(),status,id]); },
    async activity(userId, offset=0) { return (await pool.query(`SELECT * FROM activity_log ${userId ? 'WHERE actor_id=?' : ''} ORDER BY occurred_ms DESC LIMIT 50 OFFSET ?`, userId ? [userId,offset] : [offset]))[0]; },
  };
}

// Same contract for isolated HTTP tests. Production always uses the SQL store.
export function memoryIdentityStore(read) {
  const extra=new Map(), permissions=new Map(), sessions=new Map(), attempts=[], log=[];
  const all=async()=>[await read(),...extra.values()];
  return {
    async readUser(id) { return Number(id)===1 ? read() : extra.get(Number(id)); },
    async find(username) { return (await all()).find(row=>row.username===username); },
    async permissions(id) { return permissions.get(Number(id)) || []; }, async setPermissions(id,keys){permissions.set(Number(id),keys);}, async users(){ return all(); },
    async createUser(input) { if((await all()).some(row=>row.username===input.username)) throw Object.assign(new Error('Username already exists.'),{status:409}); const id=extra.size+2; extra.set(id,{...input,id,is_active:1,access_version:1,session_version:crypto.randomUUID(),legacy_deadline_ms:0}); permissions.set(id,input.domains); return id; },
    async updateUser(id,input) { const row=extra.get(Number(id)); if(!row||row.access_version!==input.version)return false; Object.assign(row,{role:input.role,is_active:input.is_active,access_version:row.access_version+1,session_version:crypto.randomUUID()}); permissions.set(Number(id),input.domains); for(const s of sessions.values())if(s.user_id===Number(id)&&!s.ended_ms&&s.expires_ms>Date.now())Object.assign(s,{ended_ms:Date.now(),end_reason:'access_changed'});return true; },
    async startSession(row){sessions.set(row.id,{...row,last_seen_ms:row.login_ms});}, async session(id){return sessions.get(id);}, async touch(id){if(sessions.has(id))sessions.get(id).last_seen_ms=Date.now();},
    async endSession(id,userId,reason='logout'){const row=sessions.get(id);if(!row||row.user_id!==Number(userId)||row.ended_ms||row.expires_ms<=Date.now())return false;Object.assign(row,{ended_ms:Date.now(),end_reason:reason});return true;},
    async endOthers(userId,except,reason='revoked'){const row=(await all()).find(a=>Number(a.id)===Number(userId));if(row)row.legacy_deadline_ms=0;for(const s of sessions.values())if(s.user_id===Number(userId)&&s.id!==except&&!s.ended_ms&&s.expires_ms>Date.now())Object.assign(s,{ended_ms:Date.now(),end_reason:reason});},
    async sessions(userId,offset=0){return [...sessions.values()].filter(s=>s.user_id===Number(userId)).reverse().slice(offset,offset+50);},
    async attempt(row){attempts.push({...row,id:attempts.length+1,occurred_ms:Date.now()});}, async failures(username,ip){return attempts.filter(a=>!a.succeeded&&a.occurred_ms>Date.now()-900000&&(a.username===username||(ip&&a.ip_address===ip))).length;}, async attempts(offset=0){return attempts.slice().reverse().slice(offset,offset+50);},
    async audit(row){const id=crypto.randomUUID();log.push({...row,id,occurred_ms:Date.now()});return id;},async finishAudit(id,status){Object.assign(log.find(row=>row.id===id),{http_status:status,finished_ms:Date.now()});},async activity(userId,offset=0){return log.filter(row=>!userId||row.actor_id===Number(userId)).slice().reverse().slice(offset,offset+50);},
  };
}
