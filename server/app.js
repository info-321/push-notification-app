import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { installPush } from './push.js';
import { selectPublicDomains, publicDomain } from './domain-configuration.js';

export function createApp({ pool, webpush, adminUsername, adminPassword, secret, publicApiBase, vapidSubject }) {
  const app = express();
  const ADMIN_USERNAME = adminUsername;
  const ADMIN_PASSWORD = adminPassword;
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));
  const { requireAdmin, createToken } = installPush(app, { pool, webpush, secret, publicApiBase, vapidSubject });

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
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      return res.json({ ok: true, token: createToken() });
    }
    return res.status(401).json({ ok: false, message: 'Invalid credentials' });
  });

  // POST /api/domains - create a domain record after frontend validation.
  app.use('/api/domains', requireAdmin);

  app.post('/api/domains', async (req, res) => {
    const { name, domain, domain_name } = req.body || {};

    const userId = 1;
    const rawDomain = domain_name || domain;
    const domainName = typeof rawDomain === 'string' ? rawDomain.trim().toLowerCase() : '';

    if (typeof name !== 'string' || !name.trim() || !/^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(domainName) || domainName.length > 253) {
      return res.status(400).json({ ok: false, message: 'A name and valid domain such as yourwebsite.com are required.' });
    }

    try {
      const verificationToken = crypto.randomBytes(24).toString('hex');
      const status = 'pending';
      const domainKey = generateDomainKey();
      const vapid = generateVapidKeys();

      const sql = `
        INSERT INTO domains (user_id, domain_name, domain_key, status, verification_token, vapid_public_key, vapid_private_key, last_check_result, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NOW(), NOW())
      `;
      await pool.query(sql, [userId, domainName, domainKey, status, verificationToken, vapid.publicKey, vapid.privateKey]);

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

  // DELETE /api/domains/:id - delete a domain by numeric id for the given user.
  app.delete('/api/domains/:id', async (req, res) => {
    const userId = 1;
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ ok: false, message: 'Invalid domain id' });
    }

    try {
      const [result] = await pool.query('DELETE FROM domains WHERE id = ? AND user_id = ?', [id, userId]);
      if (result.affectedRows === 0) {
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
    if (!domainKey) {
      return res.status(400).json({ ok: false, message: 'domain_key is required' });
    }

    try {
      const [result] = await pool.query('DELETE FROM domains WHERE domain_key = ? AND user_id = ?', [domainKey, userId]);
      if (result.affectedRows === 0) {
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
