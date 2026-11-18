import crypto from 'node:crypto';
import {accountEvent,addAccountEvent,insertAccountEvent} from './account-events.js';
import {managedResetStore} from './managed-reset.js';
import {ensurePlatform,mysqlPlatformStore,memoryPlatformStore} from './platform-store.js';
import {ensureRecovery,mysqlRecoveryStore,memoryRecoveryStore} from './recovery-store.js';
import { promisify } from 'node:util';
import { ensureIdentity, mysqlIdentityStore, memoryIdentityStore } from './identity-store.js';
const scrypt = promisify(crypto.scrypt);

export function createAdminToken(secret, version, lifetime = 12 * 60 * 60 * 1000, identity = {}) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + lifetime, v: version, ...identity })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`session:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 1024 || typeof stored !== 'string') return false;
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const key = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'hex'));
}

export function mysqlAccountRepository(pool) {
  return {
    ...mysqlIdentityStore(pool),
    ...mysqlRecoveryStore(pool),
    ...mysqlPlatformStore(pool),
    ...managedResetStore(),
    async initialize(username, password) {
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_accounts (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        session_version VARCHAR(64) NOT NULL,
        password_changed_at DATETIME(3) NULL,
        last_login_at DATETIME(3) NULL,
        last_login_ip VARCHAR(45) NULL
      )`);
      await ensureIdentity(pool);
      await ensureRecovery(pool);
      await ensurePlatform(pool);
      if (await this.read()) return;
      const c=await pool.getConnection();try{await c.beginTransaction();const [inserted]=await c.query('INSERT IGNORE INTO admin_accounts (id, username, password_hash, session_version) VALUES (1, ?, ?, ?)', [username, await hashPassword(password), crypto.randomBytes(24).toString('hex')]);if(inserted.affectedRows)await insertAccountEvent(c,accountEvent('account_created',{id:0,username:'Host operator'},{id:1,username},{source:'host_setup'}));await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}
    },
    async read(id = 1) {
      const [rows] = await pool.query('SELECT * FROM admin_accounts WHERE id = ?', [id]);
      return rows[0];
    },
    async recordLogin(hash, date, ip, id = 1) {
      const [result] = await pool.query('UPDATE admin_accounts SET last_login_at = ?, last_login_ip = ? WHERE id = ? AND password_hash = ?', [date, ip, id, hash]);
      return result.affectedRows > 0;
    },
    async changePassword(previousHash, hash, version, date, id = 1) {
      const c=await pool.getConnection();try{await c.beginTransaction();
        const [[user]]=await c.query('SELECT id,username,password_hash FROM admin_accounts WHERE id=? FOR UPDATE',[id]);
        if(!user||user.password_hash!==previousHash){await c.rollback();return false;}
        await c.query('UPDATE admin_accounts SET password_hash=?,session_version=?,password_changed_at=? WHERE id=?',[hash,version,date,id]);
        await insertAccountEvent(c,accountEvent('password_changed',user,user,{source:'self_service'}));await c.commit();return true;
      }catch(e){await c.rollback();throw e;}finally{c.release();}
    },
    async closeLegacy(id) { await pool.query('UPDATE admin_accounts SET session_version=?,legacy_deadline_ms=0 WHERE id=?',[crypto.randomUUID(),id]); },
  };
}

// Injectable in-memory repository for isolated HTTP tests. Production uses MySQL.
export function memoryAccountRepository(username, password) {
  let initialization;
  let record;
  const identity = memoryIdentityStore(async () => { await api.read(); return record; });
  const api = {
    ...identity,
    ...memoryPlatformStore(identity),
    ...managedResetStore(),
    ...memoryRecoveryStore(async id=>Number(id)===1?(await api.read(),record):identity.readUser(id),identity,event=>api.platformAtomic(d=>addAccountEvent(d,event))),
    async createUser(input,actor){
      if(!actor)return identity.createUser(input);
      return api.platformAtomic(d=>{const id=Math.max(...Object.keys(d.users).map(Number))+1;d.users[id]={id,username:input.username,password_hash:input.password_hash,role:input.role,is_active:1,access_version:1,session_version:crypto.randomUUID(),legacy_deadline_ms:0};if(Object.values(d.users).some(u=>u.id!==id&&u.username===input.username))throw Object.assign(new Error('Username already exists.'),{status:409});d.grants[id]=input.domains;addAccountEvent(d,accountEvent('account_created',actor,d.users[id],{source:'user_management',changes:{...input,is_active:true}}));return id;});
    },
    async updateUser(id,input,actor){
      if(!actor)return identity.updateUser(id,input);
      return api.platformAtomic(d=>{const user=d.users[id];if(!user||Number(id)===1||user.access_version!==input.version)return false;const previous=user.username;if(input.username&&Object.values(d.users).some(u=>u.id!==Number(id)&&u.username.toLowerCase()===input.username.toLowerCase()))throw Object.assign(new Error('Username is unavailable.'),{status:409});Object.assign(user,{username:input.username??user.username,role:input.role,is_active:input.is_active,access_version:user.access_version+1,session_version:crypto.randomUUID(),...(input.password_hash?{password_hash:input.password_hash,password_changed_at:new Date()}: {})});d.grants[id]=input.domains;addAccountEvent(d,accountEvent('account_access_changed',actor,user,{source:'user_management',changes:{...input,previous_username:previous!==user.username?previous:undefined}}));if(input.password_hash)addAccountEvent(d,accountEvent('password_changed',actor,user,{source:'user_management'}));return true;});
    },
    async read(id = 1) {
      if (Number(id) !== 1) return identity.readUser(id);
      initialization ||= hashPassword(password).then(hash => { record = { id: 1, username, role: 'admin', is_active: 1, access_version: 1, legacy_deadline_ms: Date.now() + 43200000, password_hash: hash, session_version: crypto.randomBytes(24).toString('hex'), password_changed_at: null, last_login_at: null, last_login_ip: null }; });
      await initialization;
      return { ...record };
    },
    async recordLogin(hash, date, ip, id = 1) {
      const account = Number(id) === 1 ? record : await identity.readUser(id);
      if (account.password_hash !== hash) return false;
      Object.assign(account, { last_login_at: date, last_login_ip: ip });
      return true;
    },
    async changePassword(previousHash, hash, version, date, id = 1) {
      return api.platformAtomic(d=>{const account=d.users[id];if(account.password_hash!==previousHash)return false;Object.assign(account,{password_hash:hash,session_version:version,password_changed_at:date});d.sessionReasons={[id]:'password_changed'};addAccountEvent(d,accountEvent('password_changed',account,account,{source:'self_service'}));return true;});
    },
    async closeLegacy(id) { const account=Number(id)===1?record:await identity.readUser(id);account.session_version=crypto.randomUUID();account.legacy_deadline_ms=0; },
  };
  return api;
}

export function installAccountRoutes(app, { accounts, requireAdmin, createToken, browser }) {
  const failedChanges = new Map();
  app.get('/api/account', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const row = await accounts.read(req.auth.id);
      return res.json({ ok: true, data: {
        id: row.id, role: row.role, platform_enabled:req.auth.platform_enabled,mfa_enabled:req.auth.mfa_enabled,mfa_required:req.auth.mfa_required, username: row.username, email: row.username.includes('@') ? row.username : null,
        last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        last_login_ip: row.last_login_ip, status: 'Active',
      } });
    } catch (error) {
      console.error('Account read failed:', error.code);
      return res.status(503).json({ ok: false, message: 'Account details are temporarily unavailable.' });
    }
  });

  app.post('/api/account/password', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { current_password: current, new_password: next } = req.body || {};
    if (typeof current !== 'string' || !current || current.length > 1024 || typeof next !== 'string' || next.length < 12 || next.length > 128) {
      return res.status(400).json({ ok: false, message: 'Enter your current password and a new password of 12–128 characters.' });
    }
    let attempts=failedChanges.get(req.auth.id);
    if(!attempts || Date.now()-attempts.start>900000){attempts={count:0,start:Date.now()};failedChanges.set(req.auth.id,attempts);}
    if (attempts.count >= 5) return res.status(429).json({ ok: false, message: 'Too many incorrect attempts. Try again in 15 minutes.' });
    try {
      const row = await accounts.read(req.auth.id);
      if (!await verifyPassword(current, row.password_hash)) {
        attempts.count++;
        return res.status(400).json({ ok: false, message: 'Current password is incorrect.' });
      }
      if (current === next) return res.status(400).json({ ok: false, message: 'Choose a password different from your current password.' });
      const version = crypto.randomBytes(24).toString('hex');
      if (!await accounts.changePassword(row.password_hash, await hashPassword(next), version, new Date(), req.auth.id)) {
        return res.status(409).json({ ok: false, message: 'Your account changed during this request. Please sign in again.' });
      }
      failedChanges.delete(req.auth.id);
      await accounts.endOthers(req.auth.id, null, 'password_changed');
      const token = await createToken(version, req.auth.id, req,{mfa_verified:req.auth.mfa_verified,factor_ms:req.auth.factor_ms});
      return res.json({ ok: true, csrfToken: browser.issue(res,token), message: 'Password changed. Other dashboard sessions have been signed out.' });
    } catch (error) {
      console.error('Password change failed:', error.code);
      return res.status(503).json({ ok: false, message: 'Could not change your password. Please try again.' });
    }
  });
}
