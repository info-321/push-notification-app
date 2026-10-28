import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);

export function createAdminToken(secret, version, lifetime = 12 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + lifetime, v: version })).toString('base64url');
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
      if (await this.read()) return;
      await pool.query('INSERT IGNORE INTO admin_accounts (id, username, password_hash, session_version) VALUES (1, ?, ?, ?)', [username, await hashPassword(password), crypto.randomBytes(24).toString('hex')]);
    },
    async read() {
      const [rows] = await pool.query('SELECT id, username, password_hash, session_version, password_changed_at, last_login_at, last_login_ip FROM admin_accounts WHERE id = 1');
      return rows[0];
    },
    async recordLogin(hash, date, ip) {
      const [result] = await pool.query('UPDATE admin_accounts SET last_login_at = ?, last_login_ip = ? WHERE id = 1 AND password_hash = ?', [date, ip, hash]);
      return result.affectedRows > 0;
    },
    async changePassword(previousHash, hash, version, date) {
      const [result] = await pool.query('UPDATE admin_accounts SET password_hash = ?, session_version = ?, password_changed_at = ? WHERE id = 1 AND password_hash = ?', [hash, version, date, previousHash]);
      return result.affectedRows > 0;
    },
  };
}

// Injectable in-memory repository for isolated HTTP tests. Production uses MySQL.
export function memoryAccountRepository(username, password) {
  let initialization;
  let record;
  return {
    async read() {
      initialization ||= hashPassword(password).then(hash => { record = { id: 1, username, password_hash: hash, session_version: crypto.randomBytes(24).toString('hex'), password_changed_at: null, last_login_at: null, last_login_ip: null }; });
      await initialization;
      return { ...record };
    },
    async recordLogin(hash, date, ip) {
      if (record.password_hash !== hash) return false;
      Object.assign(record, { last_login_at: date, last_login_ip: ip });
      return true;
    },
    async changePassword(previousHash, hash, version, date) {
      if (record.password_hash !== previousHash) return false;
      Object.assign(record, { password_hash: hash, session_version: version, password_changed_at: date });
      return true;
    },
  };
}

export function installAccountRoutes(app, { accounts, requireAdmin, createToken }) {
  let failedChanges = 0, changeWindow = 0;
  app.get('/api/account', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const row = await accounts.read();
      return res.json({ ok: true, data: {
        username: row.username, email: row.username.includes('@') ? row.username : null,
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
    if (Date.now() - changeWindow > 15 * 60 * 1000) { failedChanges = 0; changeWindow = Date.now(); }
    if (failedChanges >= 5) return res.status(429).json({ ok: false, message: 'Too many incorrect attempts. Try again in 15 minutes.' });
    try {
      const row = await accounts.read();
      if (!await verifyPassword(current, row.password_hash)) {
        failedChanges++;
        return res.status(400).json({ ok: false, message: 'Current password is incorrect.' });
      }
      if (current === next) return res.status(400).json({ ok: false, message: 'Choose a password different from your current password.' });
      const version = crypto.randomBytes(24).toString('hex');
      if (!await accounts.changePassword(row.password_hash, await hashPassword(next), version, new Date())) {
        return res.status(409).json({ ok: false, message: 'Your account changed during this request. Please sign in again.' });
      }
      failedChanges = 0;
      return res.json({ ok: true, token: createToken(version), message: 'Password changed. Other dashboard sessions have been signed out.' });
    } catch (error) {
      console.error('Password change failed:', error.code);
      return res.status(503).json({ ok: false, message: 'Could not change your password. Please try again.' });
    }
  });
}
