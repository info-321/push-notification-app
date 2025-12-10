import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import webpush from 'web-push';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Admin creds (login check). Keep in .env.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// MySQL pool. Make sure these env vars are set: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'push_notifications',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.use(cors());
app.use(express.json());

// Utility: generate a short domain key (8 chars, mixed set).
const generateDomainKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%!';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, message: 'Invalid credentials' });
});

// POST /api/domains - create a domain record after frontend validation.
app.post('/api/domains', async (req, res) => {
  const { userId = 1, name, domain, domain_name, timezone = '(GMT+05:30) Asia, Kolkata' } = req.body || {};

  const domainName = (domain_name || domain || '').trim().toLowerCase();

  if (!name || !domainName) {
    return res.status(400).json({ ok: false, message: 'Name and domain are required.' });
  }

  try {
    const verificationToken = `tok_${Date.now()}`;
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
      'SELECT id, user_id, domain_name, domain_key, status, vapid_public_key, created_at, updated_at FROM domains WHERE domain_key = ? LIMIT 1',
      [domainKey]
    );

    return res.json({ ok: true, data: rows[0] });
  } catch (err) {
    // Duplicate domain error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: 'Domain already exists for this user.' });
    }
    console.error('Error inserting domain', err);
    return res.status(500).json({ ok: false, message: err.message || 'Failed to save domain.' });
  }
});

// POST /api/subscriptions - save a push subscription
app.post('/api/subscriptions', async (req, res) => {
  const { subscription, domain_key, userId = 1 } = req.body || {};
  if (!subscription || !subscription.endpoint || !domain_key) {
    return res.status(400).json({ ok: false, message: 'subscription and domain_key required' });
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const auth = subscription.keys?.auth;

  try {
    await pool.query(
      'INSERT INTO subscriptions (user_id, domain_key, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [userId, domain_key, endpoint, p256dh, auth]
    );
    return res.json({ ok: true });
  } catch (err) {
    // if duplicate endpoint, treat as success
    if (err.code === 'ER_DUP_ENTRY') {
      return res.json({ ok: true });
    }
    return res.status(500).json({ ok: false, message: 'Failed to save subscription' });
  }
});


// GET /api/domains - list domains for a user (default user 1 for demo).
app.get('/api/domains', async (req, res) => {
  const userId = Number(req.query.userId || 1);
  try {
    const [rows] = await pool.query(
      'SELECT id, user_id, domain_name, domain_key, status, vapid_public_key, created_at, updated_at FROM domains WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error fetching domains', err);
    return res.status(500).json({ ok: false, message: 'Failed to fetch domains.' });
  }
});

// GET /api/domains/:key - fetch a single domain by domain_key.
app.get('/api/domains/:key', async (req, res) => {
  const domainKey = req.params.key;
  try {
    const [rows] = await pool.query(
      'SELECT id, user_id, domain_name, domain_key, status, vapid_public_key, created_at, updated_at FROM domains WHERE domain_key = ? LIMIT 1',
      [domainKey]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: 'Domain not found' });
    }
    return res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching domain by key', err);
    return res.status(500).json({ ok: false, message: 'Failed to fetch domain.' });
  }
});

// DELETE /api/domains/:id - delete a domain by numeric id for the given user.
app.delete('/api/domains/:id', async (req, res) => {
  const userId = Number(req.query.userId || 1);
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
  const userId = Number(req.query.userId || 1);
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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
