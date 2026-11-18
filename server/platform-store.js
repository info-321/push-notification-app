import crypto from 'node:crypto';
import {accountEventKinds,accountSummaries,publicAccountEvent,isAccountEvent} from './account-events.js';
import {accountVisible,privateAccountIds,privateAccountNames,rememberPrivateAccounts,historyVisible,publicActivity} from './account-visibility.js';
import {defaultPlatform,stable,appError} from './platform-crypto.js';
const parse=(value,fallback)=>typeof value==='string'?JSON.parse(value):value??fallback;
const keyed=(rows,key)=>Object.fromEntries(rows.map(r=>[String(r[key]),r]));
export async function ensurePlatform(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_state (id TINYINT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,owner_id BIGINT UNSIGNED NULL,sends_paused BOOLEAN NOT NULL DEFAULT FALSE,policy JSON NOT NULL)`);
  await pool.query('INSERT IGNORE INTO platform_state (id,policy) VALUES (1,?)',[JSON.stringify(defaultPlatform().policy)]);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_mfa (user_id BIGINT UNSIGNED PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,secret_cipher TEXT NULL,pending_cipher TEXT NULL,pending_expires_ms BIGINT NULL,last_counter BIGINT NOT NULL DEFAULT -1,recovery JSON NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_team (user_id BIGINT UNSIGNED PRIMARY KEY,admin_id BIGINT UNSIGNED NOT NULL,KEY team_admin(admin_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_config (name VARCHAR(128) PRIMARY KEY,value TEXT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_approvals (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,session_id CHAR(36) NOT NULL,session_version VARCHAR(64) NOT NULL,request_hash CHAR(64) NOT NULL,expires_ms BIGINT NOT NULL,used_ms BIGINT NULL,KEY approval_expiry(expires_ms))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_operations (id CHAR(36) PRIMARY KEY,kind VARCHAR(24) NOT NULL,status VARCHAR(24) NOT NULL,actor_id BIGINT UNSIGNED NOT NULL,created_ms BIGINT NOT NULL,details JSON NOT NULL,KEY operation_time(created_ms))`);
  pool.notizoPlatform=true;
  await mysqlPlatformStore(pool).platformAtomic(()=>{});
}
async function snapshot(c,locked=false){
  const [[row]]=await c.query('SELECT * FROM platform_state WHERE id=1'+(locked?' FOR UPDATE':''));
  const users=(await c.query('SELECT * FROM admin_accounts'+(locked?' FOR UPDATE':'')))[0];
  const access=(await c.query('SELECT * FROM user_domain_access'))[0],mfa=(await c.query('SELECT * FROM platform_mfa'))[0];
  return {state:{enabled:Boolean(row.enabled),owner_id:row.owner_id?Number(row.owner_id):null,sends_paused:Boolean(row.sends_paused),policy:parse(row.policy,{})},
    users:keyed(users.map(u=>({...u,id:Number(u.id)})),'id'),grants:Object.fromEntries(users.map(u=>[u.id,access.filter(a=>Number(a.user_id)===Number(u.id)).map(a=>a.domain_key)])),
    mfa:keyed(mfa.map(m=>({...m,enabled:Boolean(m.enabled),recovery:parse(m.recovery,[])})),'user_id'),teams:Object.fromEntries((await c.query('SELECT * FROM platform_team'))[0].map(r=>[r.user_id,Number(r.admin_id)])),
    config:Object.fromEntries((await c.query('SELECT * FROM platform_config'))[0].map(r=>[r.name,r.value])),
    approvals:keyed((await c.query('SELECT * FROM platform_approvals WHERE expires_ms>?',[Date.now()-86400000]))[0],'token_hash'),
    operations:keyed((await c.query(`SELECT * FROM platform_operations WHERE kind NOT IN (${accountEventKinds.map(()=>'?').join(',')}) ORDER BY created_ms DESC LIMIT 100`,accountEventKinds))[0].map(r=>({...r,details:parse(r.details,{})})),'id')};
}
async function persist(c,before,after){
  if(stable(before.state)!==stable(after.state))await c.query('UPDATE platform_state SET enabled=?,owner_id=?,sends_paused=?,policy=? WHERE id=1',[after.state.enabled,after.state.owner_id,after.state.sends_paused,JSON.stringify(after.state.policy)]);
  for(const [id,u]of Object.entries(after.users)){
    const old=before.users[id];
    if(!old)await c.query('INSERT INTO admin_accounts (id,username,password_hash,session_version,role,is_active,access_version,legacy_deadline_ms) VALUES (?,?,?,?,?,?,?,0)',[id,u.username,u.password_hash,u.session_version,u.role,u.is_active,u.access_version]);
    else if(stable(old)!==stable(u))await c.query('UPDATE admin_accounts SET username=?,role=?,is_active=?,access_version=?,session_version=?,password_hash=?,password_changed_at=?,legacy_deadline_ms=0 WHERE id=?',[u.username,u.role,u.is_active,u.access_version,u.session_version,u.password_hash,u.password_changed_at||null,id]);
    if(old&&old.session_version!==u.session_version)await c.query("UPDATE dashboard_sessions SET ended_ms=?,end_reason=? WHERE user_id=? AND ended_ms IS NULL",[Date.now(),after.sessionReasons?.[id]||'access_changed',id]);
    if(stable(before.grants[id]||[])!==stable(after.grants[id]||[])){
      await c.query('DELETE FROM user_domain_access WHERE user_id=?',[id]);for(const key of after.grants[id]||[])await c.query('INSERT INTO user_domain_access (user_id,domain_key) VALUES (?,?)',[id,key]);
    }
    if(before.teams[id]!==after.teams[id]){await c.query('DELETE FROM platform_team WHERE user_id=?',[id]);if(after.teams[id])await c.query('INSERT INTO platform_team (user_id,admin_id) VALUES (?,?)',[id,after.teams[id]]);}
  }
  for(const [id,m]of Object.entries(after.mfa))if(stable(before.mfa[id])!==stable(m))await c.query(`INSERT INTO platform_mfa (user_id,enabled,secret_cipher,pending_cipher,pending_expires_ms,last_counter,recovery) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),secret_cipher=VALUES(secret_cipher),pending_cipher=VALUES(pending_cipher),pending_expires_ms=VALUES(pending_expires_ms),last_counter=VALUES(last_counter),recovery=VALUES(recovery)`,[id,m.enabled,m.secret_cipher||null,m.pending_cipher||null,m.pending_expires_ms||null,m.last_counter??-1,JSON.stringify(m.recovery||[])]);
  for(const [name,value]of Object.entries(after.config))if(before.config[name]!==value)await c.query('INSERT INTO platform_config (name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',[name,value]);
  for(const [hash,a]of Object.entries(after.approvals))if(stable(before.approvals[hash])!==stable(a))await c.query('INSERT INTO platform_approvals (token_hash,user_id,session_id,session_version,request_hash,expires_ms,used_ms) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE used_ms=VALUES(used_ms)',[hash,a.user_id,a.session_id,a.session_version,a.request_hash,a.expires_ms,a.used_ms||null]);
  for(const [id,o]of Object.entries(after.operations))if(!before.operations[id])await c.query('INSERT INTO platform_operations (id,kind,status,actor_id,created_ms,details) VALUES (?,?,?,?,?,?)',[id,o.kind,o.status,o.actor_id,o.created_ms,JSON.stringify(o.details)]);
}
export function mysqlPlatformStore(pool){return {
  async platformStatus(id){const [[s]]=await pool.query('SELECT * FROM platform_state WHERE id=1');if(!s)throw new Error('Platform state unavailable.');const m=id?(await pool.query('SELECT enabled FROM platform_mfa WHERE user_id=?',[id]))[0][0]:null;return {...s,enabled:Boolean(s.enabled),sends_paused:Boolean(s.sends_paused),policy:parse(s.policy,{}),mfa_enabled:Boolean(m?.enabled)};},
  async platformRead(){return snapshot(pool);},
  async accountHistory({offset=0,userId=null}={}){
    const [users]=await pool.query('SELECT id,username,role,is_active,password_changed_at FROM admin_accounts ORDER BY id');
    const [metadata]=await pool.query("SELECT name,value FROM platform_config WHERE name LIKE 'account-audit:%'");
    const filter=userId?' AND JSON_EXTRACT(details,\'$.target_id\')=?':'';
    const [events]=await pool.query(`SELECT * FROM platform_operations WHERE kind IN (${accountEventKinds.map(()=>'?').join(',')})${filter} ORDER BY created_ms DESC,id DESC LIMIT 51 OFFSET ?`,[...accountEventKinds,...(userId?[userId]:[]),offset]);
    return {accounts:accountSummaries(users,Object.fromEntries(metadata.map(r=>[r.name,r.value]))),rows:events.slice(0,50).map(publicAccountEvent),has_more:events.length>50,offset};
  },
  async platformConfig(name){return (await pool.query('SELECT value FROM platform_config WHERE name=?',[name]))[0][0]?.value||null;},
  async platformAttempts(ids,offset=0,actor){
    const d=await this.platformRead(),where=[],params=[];
    if(ids){where.push(ids.length?'user_id IN ('+ids.map(()=>'?').join(',')+')':'FALSE');params.push(...ids);}
    if(actor?.role!=='superadmin'){
      const hidden=[...privateAccountIds(d)],names=privateAccountNames(d);
      if(hidden.length){where.push('(user_id IS NULL OR user_id NOT IN ('+hidden.map(()=>'?').join(',')+'))');params.push(...hidden);}
      if(names.length){where.push('LOWER(TRIM(username)) NOT IN ('+names.map(()=>'?').join(',')+')');params.push(...names);}
    }
    return (await pool.query(`SELECT * FROM login_attempts ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY id DESC LIMIT 50 OFFSET ?`,[...params,offset]))[0];
  },
  async platformActivity(auth,offset=0){
    const d=await this.platformRead(),ids=auth.role==='superadmin'||!d.state.enabled&&auth.role==='admin'?null:managedUsers(d,auth).map(u=>u.id),where=[],params=[];
    if(ids){where.push(ids.length?'actor_id IN ('+ids.map(()=>'?').join(',')+')':'FALSE');params.push(...ids);}
    if(auth.role!=='superadmin'){
      const hidden=[...privateAccountIds(d)],names=privateAccountNames(d);
      if(hidden.length){where.push('actor_id NOT IN ('+hidden.map(()=>'?').join(',')+')');params.push(...hidden);}
      if(names.length){where.push('LOWER(actor_name) NOT IN ('+names.map(()=>'?').join(',')+')');params.push(...names);}
    }
    return (await pool.query(`SELECT * FROM activity_log ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY occurred_ms DESC LIMIT 50 OFFSET ?`,[...params,offset]))[0].map(row=>publicActivity(row,auth));
  },
  async platformAtomic(fn){const c=await pool.getConnection();try{await c.beginTransaction();const data=await snapshot(c,true),before=structuredClone(data);const result=await fn(data);rememberPrivateAccounts(data,before);await persist(c,before,data);await c.query('DELETE FROM platform_approvals WHERE expires_ms<?',[Date.now()-86400000]);await c.query("DELETE FROM platform_config WHERE name LIKE 'reset-link:%' AND JSON_EXTRACT(IF(name LIKE 'reset-link:%',value,'{}'),'$.expires_ms')<? LIMIT 500",[Date.now()-86400000]);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}},
};}
export function memoryPlatformStore(identity){let data={state:defaultPlatform(),mfa:{},teams:{},config:{},approvals:{},operations:{}},queue=Promise.resolve();return {
  async platformStatus(id){return {...structuredClone(data.state),mfa_enabled:Boolean(data.mfa[id]?.enabled)};},
  async accountHistory({offset=0,userId=null}={}){const d=await this.platformRead(),events=Object.values(d.operations).filter(e=>isAccountEvent(e)&&(!userId||e.details.target_id===userId)).sort((a,b)=>b.created_ms-a.created_ms||b.id.localeCompare(a.id));return {accounts:accountSummaries(Object.values(d.users),d.config),rows:events.slice(offset,offset+50).map(publicAccountEvent),has_more:events.length>offset+50,offset};},
  async platformConfig(name){return data.config[name]||null;},
  async platformAttempts(ids,offset=0,actor={}){const d=await this.platformRead();return (await identity.attempts(0,Infinity)).filter(r=>(!ids||ids.includes(r.user_id))&&historyVisible(d,actor,r,'login')).slice(offset,offset+50);},
  async platformActivity(auth,offset=0){const d=await this.platformRead(),ids=auth.role==='superadmin'||!d.state.enabled&&auth.role==='admin'?null:managedUsers(d,auth).map(u=>u.id);return (await identity.activity(null,0,Infinity)).filter(r=>(!ids||ids.includes(r.actor_id))&&historyVisible(d,auth,r,'activity')).slice(offset,offset+50).map(r=>publicActivity(r,auth));},
  async platformRead(){return structuredClone({...data,users:keyed(await identity.users(),'id'),grants:Object.fromEntries(await Promise.all((await identity.users()).map(async u=>[u.id,await identity.permissions(u.id)])))});},
  async platformAtomic(fn){const run=queue.then(async()=>{const current=await this.platformRead(),before=structuredClone(current),result=await fn(current);rememberPrivateAccounts(current,before);
    for(const [id,u]of Object.entries(current.users)){const row=(await identity.users()).find(r=>Number(r.id)===Number(id));if(row)Object.assign(row,u);else{const made=await identity.createUser({...u,domains:current.grants[id]||[]});if(made!==Number(id))throw new Error('Fixture ID mismatch');Object.assign(await identity.readUser(made),u);}if(before.users[id]?.session_version!==u.session_version)await identity.endOthers(Number(id),null,current.sessionReasons?.[id]||'access_changed');await identity.setPermissions(Number(id),current.grants[id]||[]);}
    data={...current};delete data.sessionReasons;delete data.users;delete data.grants;return result;});queue=run.catch(()=>{});return run;},
};}
export const rotateAccess=user=>{user.access_version=Number(user.access_version||1)+1;user.session_version=crypto.randomBytes(24).toString('hex');};
export const managedUsers=(data,actor)=>Object.values(data.users).filter(u=>accountVisible(data,actor,u)&&(actor.role==='superadmin'||Number(u.id)===actor.id||(['editor','viewer'].includes(u.role)&&data.teams[u.id]===actor.id&&(data.grants[u.id]||[]).every(k=>(data.grants[actor.id]||[]).includes(k)))));
export const canManageUser=(data,actor,user)=>Boolean(user&&user.id!==actor.id&&managedUsers(data,actor).some(u=>u.id===user.id));
export function assertActor(data,auth){const user=data.users[auth.id];if(!user?.is_active||user.session_version!==auth.version||user.role!==auth.role)throw appError('Your access changed. Sign in again.',401);return user;}
