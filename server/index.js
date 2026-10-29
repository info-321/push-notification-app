import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import webpush from 'web-push';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ensureDomainDisplayName, ensureDomainTimeZone, ensureDomainPwa } from './domain-schema.js';
import { mysqlAccountRepository } from './accounts.js';

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) });
const port = Number(process.env.PORT || 5000);
if (!process.env.PUSH_API_SECRET || process.env.PUSH_API_SECRET.length < 32) {
  throw new Error('Set PUSH_API_SECRET in server/.env to a random secret of at least 32 characters. See server/.env.example.');
}
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin' || !process.env.PUBLIC_API_BASE?.startsWith('https://') || !process.env.VAPID_SUBJECT)) {
  throw new Error('Production requires admin credentials, PUBLIC_API_BASE (HTTPS), and VAPID_SUBJECT.');
}
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
await ensureDomainDisplayName(pool);
await ensureDomainTimeZone(pool);
await ensureDomainPwa(pool);
const accountRepository = mysqlAccountRepository(pool);
await accountRepository.initialize(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD || 'admin');
const app = createApp({
  pool, webpush, accountRepository,
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  secret: process.env.PUSH_API_SECRET,
  publicApiBase: process.env.PUBLIC_API_BASE || `http://localhost:${port}`,
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
});
app.listen(port, () => console.log(`Server listening on port ${port}`));
