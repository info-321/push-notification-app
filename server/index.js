import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

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
  const { ownerId = 1, name, domain, timezone = '(GMT+05:30) Asia, Kolkata' } = req.body || {};

  if (!name || !domain) {
    return res.status(400).json({ ok: false, message: 'Name and domain are required.' });
  }

  try {
    const verificationToken = `tok_${Date.now()}`;
    const status = 'pending';

    // Insert with uniqueness on ownerId + domain. If duplicate, MySQL throws ER_DUP_ENTRY.
    const sql = `
      INSERT INTO domains (owner_id, domain, status, verification_token, last_check_result, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NOW(), NOW())
    `;
    await pool.query(sql, [ownerId, domain.toLowerCase(), status, verificationToken]);

    // Return latest list for this owner.
    const [rows] = await pool.query(
      'SELECT id, owner_id, domain, status, last_check_result, created_at, updated_at FROM domains WHERE owner_id = ? ORDER BY created_at DESC',
      [ownerId]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    // Duplicate domain error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: 'Domain already exists for this owner.' });
    }
    // Surface a clearer error to the client and logs to help debugging (e.g., missing DB/table/auth failure)
    console.error('Error inserting domain', err);
    return res.status(500).json({ ok: false, message: err.message || 'Failed to save domain.' });
  }
});

// GET /api/domains - list domains for an owner (default owner 1 for demo).
app.get('/api/domains', async (req, res) => {
  const ownerId = Number(req.query.ownerId || 1);
  try {
    const [rows] = await pool.query(
      'SELECT id, owner_id, domain, status, last_check_result, created_at, updated_at FROM domains WHERE owner_id = ? ORDER BY created_at DESC',
      [ownerId]
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('Error fetching domains', err);
    return res.status(500).json({ ok: false, message: 'Failed to fetch domains.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
