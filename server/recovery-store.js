import crypto from 'node:crypto';

export async function ensureRecovery(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS account_recovery (
    user_id BIGINT UNSIGNED PRIMARY KEY, verified_email VARCHAR(254) NULL,
    verified_ms BIGINT NULL, pending_email VARCHAR(254) NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS account_recovery_tokens (
    token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
    purpose VARCHAR(12) NOT NULL, email VARCHAR(254) NOT NULL, session_version VARCHAR(64) NOT NULL,
    created_ms BIGINT NOT NULL, expires_ms BIGINT NOT NULL, used_ms BIGINT NULL,
    KEY recovery_user(user_id,purpose), KEY recovery_expiry(expires_ms))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS account_recovery_limits (
    key_hash CHAR(64) PRIMARY KEY, start_ms BIGINT NOT NULL, attempts INT NOT NULL,
    KEY recovery_limit_expiry(start_ms))`);
}

export function mysqlRecoveryStore(pool) {
  return {
    async recovery(id){return (await pool.query('SELECT verified_email,verified_ms,pending_email FROM account_recovery WHERE user_id=?',[id]))[0][0]||{};},
    async recoveryLimit(key,max,window=900000){
      const now=Date.now();
      await pool.query(`INSERT INTO account_recovery_limits (key_hash,start_ms,attempts) VALUES (?,?,1)
        ON DUPLICATE KEY UPDATE attempts=IF(start_ms<?,1,attempts+1),start_ms=IF(start_ms<?,VALUES(start_ms),start_ms)`,[key,now,now-window,now-window]);
      return Number((await pool.query('SELECT attempts FROM account_recovery_limits WHERE key_hash=?',[key]))[0][0].attempts)<=max;
    },
    async issueRecovery(row){
      const c=await pool.getConnection();
      try{await c.beginTransaction();
        const [[user]]=await c.query('SELECT session_version,is_active FROM admin_accounts WHERE id=? FOR UPDATE',[row.user_id]);
        if(!user?.is_active||user.session_version!==row.session_version){await c.rollback();return false;}
        if(row.purpose==='verify')await c.query('INSERT INTO account_recovery (user_id,pending_email) VALUES (?,?) ON DUPLICATE KEY UPDATE pending_email=VALUES(pending_email)',[row.user_id,row.email]);
        else {const [[r]]=await c.query('SELECT verified_email FROM account_recovery WHERE user_id=?',[row.user_id]);if(r?.verified_email!==row.email){await c.rollback();return false;}}
        await c.query('DELETE FROM account_recovery_tokens WHERE user_id=? AND purpose=?',[row.user_id,row.purpose]);
        await c.query('INSERT INTO account_recovery_tokens (token_hash,user_id,purpose,email,session_version,created_ms,expires_ms) VALUES (?,?,?,?,?,?,?)',[row.token_hash,row.user_id,row.purpose,row.email,row.session_version,Date.now(),row.expires_ms]);
        await c.commit();return true;
      }catch(error){await c.rollback();throw error;}finally{c.release();}
    },
    async discardRecovery(hash){await pool.query('DELETE FROM account_recovery_tokens WHERE token_hash=?',[hash]);},
    async redeemRecovery(hash,purpose,passwordHash){
      const [[candidate]]=await pool.query('SELECT user_id FROM account_recovery_tokens WHERE token_hash=?',[hash]);if(!candidate)return false;
      const c=await pool.getConnection();
      try{await c.beginTransaction();
        const [[user]]=await c.query('SELECT session_version,is_active FROM admin_accounts WHERE id=? FOR UPDATE',[candidate.user_id]);
        const [[token]]=await c.query('SELECT * FROM account_recovery_tokens WHERE token_hash=? FOR UPDATE',[hash]);
        if(!token||token.purpose!==purpose||token.used_ms||Number(token.expires_ms)<=Date.now()||!user?.is_active||user.session_version!==token.session_version){await c.rollback();return false;}
        const [[recovery]]=await c.query('SELECT verified_email,pending_email FROM account_recovery WHERE user_id=? FOR UPDATE',[candidate.user_id]);
        if(purpose==='verify'){
          if(recovery?.pending_email!==token.email){await c.rollback();return false;}
          await c.query('UPDATE account_recovery SET verified_email=?,verified_ms=?,pending_email=NULL WHERE user_id=?',[token.email,Date.now(),candidate.user_id]);
        }else{
          if(recovery?.verified_email!==token.email){await c.rollback();return false;}
          await c.query('UPDATE admin_accounts SET password_hash=?,session_version=?,password_changed_at=?,legacy_deadline_ms=0 WHERE id=?',[passwordHash,crypto.randomBytes(24).toString('hex'),new Date(),candidate.user_id]);
          await c.query("UPDATE dashboard_sessions SET ended_ms=?,end_reason='password_reset' WHERE user_id=? AND ended_ms IS NULL",[Date.now(),candidate.user_id]);
        }
        await c.query('UPDATE account_recovery_tokens SET used_ms=? WHERE user_id=?',[Date.now(),candidate.user_id]);
        await c.commit();return {user_id:Number(candidate.user_id)};
      }catch(error){await c.rollback();throw error;}finally{c.release();}
    },
  };
}

// Isolated tests use the same single-use/version checks without real email or DB.
export function memoryRecoveryStore(read,identity){
  const recovery=new Map(),tokens=new Map(),limits=new Map();
  return {
    async recovery(id){return {...recovery.get(Number(id))};},
    async recoveryLimit(key,max,window=900000){let r=limits.get(key);if(!r||r.start<Date.now()-window){r={start:Date.now(),n:0};limits.set(key,r);}return ++r.n<=max;},
    async issueRecovery(row){const user=await read(row.user_id);if(!user?.is_active||user.session_version!==row.session_version)return false;let r=recovery.get(row.user_id)||{};if(row.purpose==='verify')r.pending_email=row.email;else if(r.verified_email!==row.email)return false;recovery.set(row.user_id,r);for(const [key,t]of tokens)if(t.user_id===row.user_id&&t.purpose===row.purpose)tokens.delete(key);tokens.set(row.token_hash,{...row});return true;},
    async discardRecovery(hash){tokens.delete(hash);},
    async redeemRecovery(hash,purpose,passwordHash){const t=tokens.get(hash);if(!t)return false;const user=await read(t.user_id),r=recovery.get(t.user_id);if(t.used_ms||t.purpose!==purpose||t.expires_ms<=Date.now()||!user?.is_active||user.session_version!==t.session_version)return false;
      if(purpose==='verify'){if(r?.pending_email!==t.email)return false;Object.assign(r,{verified_email:t.email,verified_ms:Date.now(),pending_email:null});}
      else {if(r?.verified_email!==t.email)return false;Object.assign(user,{password_hash:passwordHash,session_version:crypto.randomBytes(24).toString('hex'),password_changed_at:new Date(),legacy_deadline_ms:0});}
      for(const token of tokens.values())if(token.user_id===t.user_id)token.used_ms=Date.now();
      if(purpose==='reset')await identity.endOthers(t.user_id,null,'password_reset');return {user_id:t.user_id};},
  };
}
