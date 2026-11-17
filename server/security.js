import crypto from 'node:crypto';
import { createAdminToken, hashPassword } from './accounts.js';
import { tokenHash } from './identity-store.js';
import { requestVisitorIp } from './audience.js';
import { requestDevice, requestBrowser } from './subscriber-device.js';

export function loginMetadata(req) {
  const ua = req.get('User-Agent') || '';
  return { ip_address: requestVisitorIp(req), device: requestDevice(req), browser: requestBrowser(req),
    os: /iPhone|iPod/i.test(ua) ? 'iOS' : /iPad/i.test(ua) ? 'iPadOS' : /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /Macintosh/i.test(ua) ? 'macOS' : /Linux|X11/i.test(ua) ? 'Linux' : null };
}
export function createSecurity({ accounts, pool, secret }) {
  const createToken = async (version, userId = 1, req) => {
    const id = crypto.randomUUID(), lifetime = 12 * 3600000;
    const token = createAdminToken(secret, version, lifetime, { uid: Number(userId), sid: id });
    await accounts.startSession({ id, user_id: Number(userId), token_hash: tokenHash(token), login_ms: Date.now(), expires_ms: Date.now()+lifetime, ...(req ? loginMetadata(req) : { ip_address:null,device:null,browser:null,os:null }) });
    return token;
  };
  const authenticate = async req => {
    if (req.auth) return true;
    const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
    let session;
    try {
      const [payload, signature, extra] = token.split('.');
      const expected = crypto.createHmac('sha256', secret).update(`session:${payload}`).digest('base64url');
      if (extra || typeof signature !== 'string' || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return false;
      session = JSON.parse(Buffer.from(payload,'base64url'));
      if (!Number.isFinite(session.exp) || session.exp <= Date.now()) return false;
    } catch { return false; }
    const account = await accounts.read(session.uid || 1);
    if (!account || !account.is_active || !(session.v===account.session_version || (session.v===undefined&&!account.password_changed_at))) return false;
    if (session.sid) {
      const saved = await accounts.session(session.sid);
      if (!saved || saved.user_id!==Number(account.id) || saved.token_hash!==tokenHash(token) || saved.ended_ms || saved.expires_ms<=Date.now()) return false;
      await accounts.touch(session.sid);
    } else if (Number(account.id)!==1 || session.exp>Number(account.legacy_deadline_ms || 0)) return false;
    req.auth = { id:Number(account.id), username:account.username, role:account.role, sid:session.sid || null,
      domains: account.role==='admin' ? null : await accounts.permissions(account.id) };
    return true;
  };
  const domainAllowed = (req, key, write=false) => req.auth?.role==='admin' ||
    Boolean(req.auth && (!write || req.auth.role==='editor') && req.auth.domains.includes(key));
  const authorizeRequest = async req => {
    const pathname = new URL(req.originalUrl,'http://internal').pathname;
    const domainPath=pathname.match(/^\/api\/domains\/([^/]+)\//);
    if(domainPath)req.auditDomain=decodeURIComponent(domainPath[1]);
    if (req.auth.role==='admin') return true;
    const write = !['GET','HEAD','OPTIONS'].includes(req.method);
    if (pathname==='/api/logout' || pathname.startsWith('/api/account/')) return true;
    if (pathname==='/api/account') return true;
    if (pathname==='/api/domains' && req.method==='GET') return true;
    let key;
    const match=pathname.match(/^\/api\/domains\/([^/]+)(.*)$/);
    if (match) {
      key=decodeURIComponent(match[1]);
      if (!match[2] && /^\d+$/.test(key)) key=(await pool.query('SELECT domain_key FROM domains WHERE id=? AND user_id=1',[Number(key)]))[0][0]?.domain_key;
      if (match[2]==='/integration' && req.auth.role==='viewer') return false;
    } else if (pathname.startsWith('/api/schedules/')) {
      if (pathname==='/api/schedules/status') return !write;
      if (pathname==='/api/schedules/preview') return req.auth.role==='editor';
      const id=pathname.split('/')[3]; key=(await pool.query('SELECT domain_key FROM notification_schedules WHERE id=? AND user_id=1',[id]))[0][0]?.domain_key;
    } else if (pathname==='/api/schedules') key=req.body?.domain_key;
    if (!key) return false;
    req.auditDomain=key;
    return domainAllowed(req,key,write);
  };
  const auditMutation = async req => {
    if (req.auditId || ['GET','HEAD','OPTIONS'].includes(req.method) || req.originalUrl.startsWith('/api/account/heartbeat')) return;
    const path=new URL(req.originalUrl,'http://internal').pathname;
    const key=req.auditDomain || req.body?.domain_key;
    const target=path==='/api/users'&&req.method==='POST'&&typeof req.body?.username==='string'?` (${req.body.username.trim().slice(0,64)})`:'';
    req.auditId=await accounts.audit({actor_id:req.auth.id,actor_name:req.auth.username,domain_key:typeof key==='string'?key.slice(0,64):null,
      action:(path+target).slice(0,128),method:req.method});
    req.res.once('finish',()=>{accounts.finishAudit(req.auditId,req.res.statusCode).catch(error=>console.error('Activity result storage failed:',error.code));});
  };
  const requireAdmin = async (req,res,next) => {
    try {
      if (!await authenticate(req)) return res.status(401).json({ok:false,message:'Please sign in again.'});
      const allowed=await authorizeRequest(req);
      await auditMutation(req);
      if (!allowed) return res.status(403).json({ok:false,message:'Your account does not have permission for this website or action.'});
      return next();
    } catch(error) { console.error('Session/access check failed:',error.code); return res.status(503).json({ok:false,message:'Sign in is temporarily unavailable.'}); }
  };
  return {createToken,authenticate,requireAdmin,domainAllowed,auditMutation};
}

const publicUser = row => ({id:Number(row.id),username:row.username,role:row.role,is_active:Boolean(row.is_active),version:row.access_version,last_login_at:row.last_login_at || null});
const publicSession = (row,current) => ({id:row.id,current:row.id===current,login_ms:Number(row.login_ms),last_seen_ms:Number(row.last_seen_ms),expires_ms:Number(row.expires_ms),
  ended_ms:row.ended_ms?Number(row.ended_ms):null,end_reason:row.end_reason || (row.expires_ms<=Date.now()?'expired':null),status:row.ended_ms?'ended':row.expires_ms<=Date.now()?'expired':'active',ip_address:row.ip_address,device:row.device,browser:row.browser,os:row.os,source:row.source || 'interactive'});
export function installSecurityRoutes(app,{accounts,pool,security}) {
  const {requireAdmin}=security;
  const offset=req=>Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
  app.post('/api/logout',requireAdmin,async(req,res)=>{
    try {
      if(req.auth.sid) await accounts.endSession(req.auth.sid,req.auth.id);
      else {await accounts.closeLegacy(req.auth.id);await accounts.endOthers(req.auth.id,null,'legacy_logout');}
      res.json({ok:true});
    }catch{res.status(503).json({ok:false,message:'Could not record logout. Please try again.'});}
  });
  app.post('/api/account/heartbeat',requireAdmin,(req,res)=>res.json({ok:true}));
  app.get('/api/account/sessions',requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json({ok:true,data:(await accounts.sessions(req.auth.id,offset(req))).map(row=>publicSession(row,req.auth.sid))});}catch{res.status(503).json({ok:false,message:'Could not load sessions.'});}});
  app.delete('/api/account/sessions/:id',requireAdmin,async(req,res)=>{try{const ended=await accounts.endSession(req.params.id,req.auth.id,'revoked');res.status(ended?200:404).json({ok:ended,message:ended?'Session revoked.':'Session not found.'});}catch{res.status(503).json({ok:false,message:'Could not revoke session.'});}});
  app.post('/api/account/sessions/revoke-others',requireAdmin,async(req,res)=>{try{await accounts.endOthers(req.auth.id,req.auth.sid);res.json({ok:true});}catch{res.status(503).json({ok:false,message:'Could not revoke sessions.'});}});
  app.get('/api/account/activity',requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store').json({ok:true,data:await accounts.activity(req.auth.role==='admin'?null:req.auth.id,offset(req))});}catch{res.status(503).json({ok:false,message:'Could not load activity.'});}});
  app.use('/api/users',requireAdmin,(req,res,next)=>req.auth.role==='admin'?next():res.status(403).json({ok:false,message:'Administrator access is required.'}));
  app.get('/api/users',async(req,res)=>{try{res.set('Cache-Control','no-store').json({ok:true,data:await Promise.all((await accounts.users()).map(async row=>({...publicUser(row),domains:await accounts.permissions(row.id)})))});}catch{res.status(503).json({ok:false,message:'Could not load users.'});}});
  const validate=async input=>{
    if(!['admin','editor','viewer'].includes(input.role)||!Array.isArray(input.domains)||input.domains.length>100||new Set(input.domains).size!==input.domains.length||input.domains.some(key=>typeof key!=='string'||key.length>64))throw Object.assign(new Error('Choose a role and valid websites.'),{status:400});
    const [rows]=await pool.query('SELECT domain_key FROM domains WHERE user_id=1');
    if(input.domains.some(key=>!rows.some(row=>row.domain_key===key)))throw Object.assign(new Error('A selected website is unavailable.'),{status:400});
  };
  app.post('/api/users',async(req,res)=>{try{const input=req.body||{};if(typeof input.username!=='string'||!input.username.trim()||input.username.length>255||typeof input.password!=='string'||input.password.length<12||input.password.length>128) return res.status(400).json({ok:false,message:'Enter a username and a password of 12–128 characters.'});await validate(input);const id=await accounts.createUser({username:input.username.trim(),password_hash:await hashPassword(input.password),role:input.role,domains:input.role==='admin'?[]:input.domains});res.status(201).json({ok:true,data:{id}});}catch(error){res.status(error.status||503).json({ok:false,message:error.status?error.message:'Could not create user.'});}});
  app.patch('/api/users/:id',async(req,res)=>{try{const input=req.body||{},id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=1||id===req.auth.id)return res.status(400).json({ok:false,message:'The original administrator and your own access cannot be changed here.'});if(typeof input.is_active!=='boolean'||!Number.isSafeInteger(input.version))return res.status(400).json({ok:false,message:'Reload the user before updating access.'});await validate(input);const ok=await accounts.updateUser(id,{...input,domains:input.role==='admin'?[]:input.domains});res.status(ok?200:409).json({ok,message:ok?'Access updated; existing sessions revoked.':'User changed. Reload before saving.'});}catch(error){res.status(error.status||503).json({ok:false,message:error.status?error.message:'Could not update user.'});}});
  app.get('/api/users/login-attempts',async(req,res)=>{try{res.set('Cache-Control','no-store').json({ok:true,data:await accounts.attempts(offset(req))});}catch{res.status(503).json({ok:false,message:'Could not load login attempts.'});}});
  app.get('/api/users/:id/sessions',async(req,res)=>{try{if(!await accounts.read(Number(req.params.id)))return res.status(404).json({ok:false,message:'User not found.'});res.set('Cache-Control','no-store').json({ok:true,data:(await accounts.sessions(Number(req.params.id),offset(req))).map(row=>publicSession(row,req.auth.sid))});}catch{res.status(503).json({ok:false,message:'Could not load sessions.'});}});
  app.delete('/api/users/:id/sessions/:session',async(req,res)=>{try{const ended=await accounts.endSession(req.params.session,Number(req.params.id),'admin_revoked');res.status(ended?200:404).json({ok:ended});}catch{res.status(503).json({ok:false,message:'Could not revoke session.'});}});
}
