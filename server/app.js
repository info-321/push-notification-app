import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { installPush } from './push.js';
import { selectPublicDomains, publicDomain } from './domain-configuration.js';
import { deleteOwnedDomain } from './domain-management.js';
import { installDomainSettings, validTimeZone, defaultTimeZone } from './domain-settings.js';
import { installAccountRoutes, memoryAccountRepository, verifyPassword } from './accounts.js';

export function createApp({ pool, webpush, adminUsername, adminPassword, secret, publicApiBase, vapidSubject, accountRepository }) {
  const app = express();
  const accounts = accountRepository || memoryAccountRepository(adminUsername, adminPassword);
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));
  const { requireAdmin, createToken } = installPush(app, { pool, webpush, secret, publicApiBase, vapidSubject, accounts });
  installAccountRoutes(app, { accounts, requireAdmin, createToken });

  // Utility: generate a URL-safe domain key (Base64URL, no padding) so it's safe in URLs/headers.
  const generateDomainKey = () => {
    // 12 random bytes -> 16-char base64url string (URL-safe, no + / or =).
    return crypto.randomBytes(12).toString('base64url');
  };

  // Utility: generate real VAPID keys using web-push (safe for PushManager).
  const generateVapidKeys = () => {
    const keys = webpush.generateVAPIDKeys();
    return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  };

  // POST /api/login - basic admin auth.
  let failedLogins = 0, loginWindow = 0;
  app.post('/api/login', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { username, password } = req.body || {};
    if (Date.now() - loginWindow > 15 * 60 * 1000) { failedLogins = 0; loginWindow = Date.now(); }
    if (failedLogins >= 10) return res.status(429).json({ ok: false, message: 'Too many incorrect attempts. Try again in 15 minutes.' });
    try {
      const row = await accounts.read();
      if (!row || !await verifyPassword(password, row.password_hash) || username !== row.username) {
        failedLogins++;
        return res.status(401).json({ ok: false, message: 'Invalid credentials' });
      }
      if (!await accounts.recordLogin(row.password_hash, new Date(), req.socket.remoteAddress?.replace(/^::ffff:/, '') || null)) {
        return res.status(401).json({ ok: false, message: 'Credentials changed. Please sign in again.' });
      }
      failedLogins = 0;
      return res.json({ ok: true, token: createToken(row.session_version) });
    } catch (error) {
      console.error('Login failed:', error.code);
      return res.status(503).json({ ok: false, message: 'Sign in is temporarily unavailable. Please try again.' });
    }
  });

  // POST /api/domains - create a domain record after frontend validation.
  app.use('/api/domains', requireAdmin);
  installDomainSettings(app, pool);

  app.post('/api/domains', async (req, res) => {
    const { name, domain, domain_name } = req.body || {};

    const userId = 1;
    const rawDomain = domain_name || domain;
    const domainName = typeof rawDomain === 'string' ? rawDomain.trim().toLowerCase() : '';
    const timeZone = req.body?.time_zone ?? defaultTimeZone;
    if (!validTimeZone(timeZone)) return res.status(400).json({ ok: false, message: 'Choose a valid time zone.' });

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 255 || !/^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(domainName) || domainName.length > 253) {
      return res.status(400).json({ ok: false, message: 'A name and valid domain such as yourwebsite.com are required.' });
    }

    try {
      const verificationToken = crypto.randomBytes(24).toString('hex');
      const status = 'pending';
      const domainKey = generateDomainKey();
      const vapid = generateVapidKeys();

      const sql = `
        INSERT INTO domains (user_id, domain_name, domain_key, status, verification_token, vapid_public_key, vapid_private_key, display_name, time_zone, last_check_result, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(), NOW())
      `;
      await pool.query(sql, [userId, domainName, domainKey, status, verificationToken, vapid.publicKey, vapid.privateKey, name.trim(), timeZone]);

      // Fetch the inserted row to return to the client (without private key).
      const [rows] = await pool.query(
        `${selectPublicDomains} WHERE d.domain_key = ? AND d.user_id = 1 LIMIT 1`,
        [domainKey]
      );

      return res.json({ ok: true, data: publicDomain(rows[0]) });
    } catch (err) {
      // Duplicate domain error
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Domain already exists for this user.' });
      }
      console.error('Error inserting domain', err);
      return res.status(500).json({ ok: false, message: 'Failed to save domain. Check the database connection.' });
    }
  });

  // GET /api/domains - list domains for a user (default user 1 for demo).
  app.get('/api/domains', async (req, res) => {
    const userId = 1;
    try {
      const [rows] = await pool.query(
        `${selectPublicDomains} WHERE d.user_id = ? ORDER BY d.created_at DESC`,
        [userId]
      );
      return res.json({ ok: true, data: rows.map(publicDomain) });
    } catch (err) {
      console.error('Error fetching domains', err);
      return res.status(500).json({ ok: false, message: 'Failed to fetch domains.' });
    }
  });

  // Counts describe saved browser subscriptions, not unique people or delivery receipts.
  app.get('/api/domains/:key/overview', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `${selectPublicDomains} WHERE d.domain_key = ? AND d.user_id = 1 LIMIT 1`,
        [req.params.key]
      );
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Domain not found' });
      const [[counts]] = await pool.query(
        `SELECT COUNT(*) AS subscribers FROM subscriptions
         WHERE domain_key = ? AND user_id = ?
           AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''`,
        [req.params.key, rows[0].user_id]
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, data: {
        domain: publicDomain(rows[0]),
        subscribers: { total: Number(counts.subscribers), web: Number(counts.subscribers), mobile: null, app: null },
        updated_at: new Date().toISOString(),
      } });
    } catch (err) {
      console.error('Error fetching domain overview', err);
      return res.status(500).json({ ok: false, message: 'Failed to load dashboard.' });
    }
  });

  // GET /api/domains/:key - fetch a single domain by domain_key.
  app.get('/api/domains/:key', async (req, res) => {
    const domainKey = req.params.key;
    try {
      const [rows] = await pool.query(
        `${selectPublicDomains} WHERE d.domain_key = ? AND d.user_id = 1 LIMIT 1`,
        [domainKey]
      );
      if (!rows.length) {
        return res.status(404).json({ ok: false, message: 'Domain not found' });
      }
      return res.json({ ok: true, data: publicDomain(rows[0]) });
    } catch (err) {
      console.error('Error fetching domain by key', err);
      return res.status(500).json({ ok: false, message: 'Failed to fetch domain.' });
    }
  });

  // Rename the display label without changing the registered site or push credentials.
  app.patch('/api/domains/:id', async (req, res) => {
    const id = Number(req.params.id);
    const name = req.body?.name;
    if (!Number.isSafeInteger(id) || id <= 0 || typeof name !== 'string' || !name.trim() || name.trim().length > 255) {
      return res.status(400).json({ ok: false, message: 'A valid domain id and name of up to 255 characters are required.' });
    }
    try {
      const [result] = await pool.query('UPDATE domains SET display_name = ? WHERE id = ? AND user_id = ?', [name.trim(), id, 1]);
      if (!result.affectedRows) return res.status(404).json({ ok: false, message: 'Domain not found' });
      const [rows] = await pool.query(`${selectPublicDomains} WHERE d.id = ? AND d.user_id = 1 LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, message: 'Domain not found' });
      return res.json({ ok: true, data: publicDomain(rows[0]) });
    } catch (error) {
      console.error('Error updating domain name', error.code);
      return res.status(500).json({ ok: false, message: 'Failed to update the domain name.' });
    }
  });

  // DELETE /api/domains/:id - delete a domain by numeric id for the given user.
  app.delete('/api/domains/:id', async (req, res) => {
    const userId = 1;
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid domain id' });
    }

    try {
      if (!await deleteOwnedDomain(pool, 'id', id, userId)) {
        return res.status(404).json({ ok: false, message: 'Domain not found' });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('Error deleting domain by id', err);
      return res.status(500).json({ ok: false, message: 'Failed to delete domain.' });
    }
  });

  // DELETE /api/domains?userId=1&domain_key=XXX - delete by domain_key (fallback for clients using keys).
  app.delete('/api/domains', async (req, res) => {
    const userId = 1;
    const domainKey = req.query.domain_key;
    if (typeof domainKey !== 'string' || !domainKey) {
      return res.status(400).json({ ok: false, message: 'domain_key is required' });
    }

    try {
      if (!await deleteOwnedDomain(pool, 'domain_key', domainKey, userId)) {
        return res.status(404).json({ ok: false, message: 'Domain not found' });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('Error deleting domain by key', err);
      return res.status(500).json({ ok: false, message: 'Failed to delete domain.' });
    }
  });


  return app;
}
