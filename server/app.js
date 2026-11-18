import { deviceCountSql, summarizeDevices } from './subscriber-device.js';
import express from 'express';
import cors from 'cors';
import {browserAuth} from './browser-auth.js';
import {installRecoveryRoutes} from './recovery.js';
import crypto from 'node:crypto';
import {installPlatformAuth,mfaRequired} from './platform-auth.js';
import {installPlatformUsers} from './platform-users.js';
import {managedMailer} from './platform-services.js';
import {installPlatformRoutes} from './platform-routes.js';
import { installPush } from './push.js';
import { selectPublicDomains, publicDomain } from './domain-configuration.js';
import { deleteOwnedDomain } from './domain-management.js';
import { installDomainSettings, validTimeZone, defaultTimeZone } from './domain-settings.js';
import { installAccountRoutes, memoryAccountRepository, verifyPassword, hashPassword } from './accounts.js';
import { installPwa, pwaBodyParser } from './pwa.js';
import { installAudience } from './audience.js';
import { installAnalytics } from './analytics.js';
import { installPushContent, pushImageBodyParser } from './push-content.js';
import { installSubscriptionPrompts } from './subscription-prompts.js';
import { installSchedules } from './schedules.js';
import { installReports } from './reports.js';
import { installTargeting } from './targeting.js';
import { installSecurityRoutes, loginMetadata } from './security.js';
import { installUnsubscribe } from './subscription-history.js';
import { installDrafts } from './drafts.js';
import { installSubscriberLocation } from './subscriber-location.js';

export function createApp({ pool, webpush, adminUsername, adminPassword, secret, publicApiBase, vapidSubject, accountRepository, reporting, dashboardOrigins=process.env.DASHBOARD_ORIGINS||'', mailer, dashboardBase=publicApiBase }) {
  const app = express();
  const accounts = accountRepository || memoryAccountRepository(adminUsername, adminPassword);
  mailer=managedMailer({accounts,secret,fallback:mailer});
  pool.notizoPlatformStatus=()=>accounts.platformStatus();
  pool.notizoPlatformConfig=name=>accounts.platformConfig(name);
  const browser=browserAuth({secret,publicApiBase,dashboardOrigins});
  app.use(cors((req,done)=>done(null,browser.origins.has(req.get('Origin'))?{origin:req.get('Origin'),credentials:true}:{origin:'*'})));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  pwaBodyParser(app);
  pushImageBodyParser(app);
  app.use(express.json({ limit: '32kb' }));
  const { requireAdmin, createToken, security } = installPush(app, { pool, webpush, secret, publicApiBase, vapidSubject, accounts, reporting, browser });
  installTargeting(app, { pool, requireAdmin });
  installSubscriberLocation(app, { pool, secret });
  installReports(app, { pool, secret, requireAdmin });
  installPushContent(app, { pool, requireAdmin, publicApiBase });
  installSubscriptionPrompts(app, { pool, secret, requireAdmin });
  installSchedules(app, { pool, requireAdmin });
  installAccountRoutes(app, { accounts, requireAdmin, createToken, browser });
  installPlatformAuth(app,{accounts,security,secret});
  installPlatformUsers(app,{accounts,pool,security});
  installPlatformRoutes(app,{accounts,pool,security,mailer,secret});
  installSecurityRoutes(app, {accounts,pool,security});
  installDrafts(app, {pool,requireAdmin,security});
  installUnsubscribe(app,{pool,requireAdmin});

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
  const dummyPassword = hashPassword(crypto.randomBytes(32).toString('hex'));
  app.get('/api/auth/session',async(req,res)=>{try{const authenticated=await security.authenticate(req);res.json({ok:true,authenticated:Boolean(authenticated&&req.auth.full_access),mfa_required:Boolean(authenticated&&!req.auth.full_access),mfa_enrollment_required:Boolean(authenticated&&req.auth.mfa_required&&!req.auth.mfa_enabled),csrfToken:browser.bootstrap(req,res)});}catch{res.status(503).json({ok:false,message:'Session check unavailable.'});}});
  installRecoveryRoutes(app,{accounts,requireAdmin,browser,mailer,secret,dashboardBase});
  app.post('/api/login', browser.guard, async (req, res) => {
    res.set('Cache-Control','no-store');
    const {username,password}=req.body || {};
    if(typeof username!=='string'||username.length>255||!username.trim()) return res.status(400).json({ok:false,message:'Enter your username and password.'});
    const metadata=loginMetadata(req);
    try {
      if(await accounts.failures(username,metadata.ip_address)>=10) return res.set('Retry-After','900').status(429).json({ok:false,message:'Too many incorrect attempts. Try again in 15 minutes.'});
      const row=await accounts.find(username);
      const valid=await verifyPassword(password,row?.password_hash || await dummyPassword);
      await accounts.attempt({username,user_id:row?.id,succeeded:Boolean(valid&&row?.is_active),...metadata});
      if(!valid||!row?.is_active) return res.status(401).json({ok:false,message:'Invalid credentials'});
      if(!await accounts.recordLogin(row.password_hash,new Date(),metadata.ip_address,row.id)) return res.status(401).json({ok:false,message:'Credentials changed. Please sign in again.'});
      const old=browser.session(req);if(old){await security.authenticate(req);if(req.auth?.sid)await accounts.endSession(req.auth.sid,req.auth.id,'replaced');}
      const state=await accounts.platformStatus(row.id),required=mfaRequired(state,row);
      const token=await createToken(row.session_version,row.id,req,{mfa_verified:false});
      return res.json({ok:true,csrfToken:browser.issue(res,token),mfa_required:required,mfa_enrollment_required:required&&!state.mfa_enabled});
    } catch(error) {console.error('Login failed:',error.code);return res.status(503).json({ok:false,message:'Sign in is temporarily unavailable. Please try again.'});}
  });

  // POST /api/domains - create a domain record after frontend validation.
  app.use('/api/domains', requireAdmin,(req,res,next)=>{if(req.auth.platform_enabled&&req.method==='DELETE'){if(!req.params.id&&new URL(req.originalUrl,'http://internal').pathname==='/api/domains')return res.status(400).json({ok:false,message:'Delete using the website ID.'});return security.requireFresh(req,res,next);}next();});
  installDomainSettings(app, pool);
  installPwa(app, pool);
  installAudience(app, pool);
  installAnalytics(app, pool);

  app.post('/api/domains', async (req, res) => {
    const { name, domain, domain_name } = req.body || {};

    if(!req.auth.global) return res.status(403).json({ok:false,message:'Only administrators can add websites.'});
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
      return res.json({ ok: true, data: rows.filter(row=>security.domainAllowed(req,row.domain_key)).map(publicDomain) });
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
        `SELECT COUNT(*) AS subscribers, ${deviceCountSql} FROM subscriptions
         WHERE domain_key = ? AND user_id = ?
           AND COALESCE(p256dh, '') <> '' AND COALESCE(auth, '') <> ''`,
        [req.params.key, rows[0].user_id]
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, data: {
        domain: publicDomain(rows[0]),
        subscribers: { total: Number(counts.subscribers), web: Number(counts.subscribers), ...summarizeDevices(counts), app: null },
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
    if(!req.auth.global) return res.status(403).json({ok:false,message:'Only administrators can delete websites.'});
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
      if (err.code === 'SCHEDULE_RUNNING') return res.status(409).json({ ok: false, message: err.message });
      console.error('Error deleting domain by id', err);
      return res.status(500).json({ ok: false, message: 'Failed to delete domain.' });
    }
  });

  // DELETE /api/domains?userId=1&domain_key=XXX - delete by domain_key (fallback for clients using keys).
  app.delete('/api/domains', async (req, res) => {
    if(!req.auth.global) return res.status(403).json({ok:false,message:'Only administrators can delete websites.'});
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
      if (err.code === 'SCHEDULE_RUNNING') return res.status(409).json({ ok: false, message: err.message });
      console.error('Error deleting domain by key', err);
      return res.status(500).json({ ok: false, message: 'Failed to delete domain.' });
    }
  });


  return app;
}
