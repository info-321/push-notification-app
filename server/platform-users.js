import crypto from 'node:crypto';
import {accountVisible} from './account-visibility.js';
import {hashPassword} from './accounts.js';
import {managedUsers,assertActor,rotateAccess} from './platform-store.js';
import {appError} from './platform-crypto.js';
const publicUser=(d,u,actor)=>({id:u.id,username:u.username,role:u.role,is_active:Boolean(u.is_active),version:u.access_version,domains:d.grants[u.id]||[],manager_id:accountVisible(d,actor,d.users[d.teams[u.id]])?d.teams[u.id]:null,mfa_enabled:Boolean(d.mfa[u.id]?.enabled),last_login_at:u.last_login_at||null});
export function changeManagedUser(d,auth,input,id,passwordHash,domainKeys){
  const actor=assertActor(d,auth),owner=actor.role==='superadmin';
  if(!owner&&actor.role!=='admin')throw appError('Administrator access is required.',403);
  if(Object.keys(input).some(k=>!['username','password','role','domains','is_active','version','manager_id'].includes(k)))throw appError('Unexpected user setting.');
  if(!['superadmin','admin','editor','viewer'].includes(input.role)||!Array.isArray(input.domains)||input.domains.length>100||new Set(input.domains).size!==input.domains.length||input.domains.some(k=>!domainKeys.includes(k)))throw appError('Choose a valid role and websites.');
  if(!owner&&(!['editor','viewer'].includes(input.role)||input.domains.some(k=>!(d.grants[actor.id]||[]).includes(k))))throw appError('You can manage Editors and Viewers only within your assigned websites.',403);
  let user;
  if(id!==null&&(!Number.isSafeInteger(id)||id<1))throw appError('Invalid user.');
  if(id){user=d.users[id];if(!user||!managedUsers(d,actor).some(u=>u.id===id))throw appError('User is unavailable.',404);if(id===actor.id)throw appError('Change another account here; your own access is protected.');if(!owner&&!['editor','viewer'].includes(user.role))throw appError('You cannot change this role.',403);if(input.version!==user.access_version)throw appError('User changed. Reload before saving.',409);if(typeof input.is_active!=='boolean')throw appError('Choose an account status.');}
  else {if(typeof input.username!=='string'||!input.username.trim()||input.username.length>255||!passwordHash)throw appError('Enter a username and a password of 12-128 characters.');if(Object.values(d.users).some(u=>u.username.toLowerCase()===input.username.trim().toLowerCase()))throw appError('Username already exists.',409);id=Math.max(0,...Object.keys(d.users).map(Number))+1;user={id,username:input.username.trim(),password_hash:passwordHash,session_version:crypto.randomUUID(),access_version:1,is_active:1};d.users[id]=user;}
  const manager=owner?(input.manager_id?Number(input.manager_id):null):actor.id;
  if(manager!==null&&(!Number.isSafeInteger(manager)||manager<1))throw appError('Choose a valid team administrator.');
  if(manager){const admin=d.users[manager];if(!admin?.is_active||admin.role!=='admin'||!['editor','viewer'].includes(input.role)||input.domains.some(k=>!(d.grants[manager]||[]).includes(k)))throw appError('The team manager must be an active Admin assigned to every selected website.');}
  const activeOwner=user.role==='superadmin'&&Boolean(user.is_active);
  if(activeOwner&&(input.role!=='superadmin'||!input.is_active)){
    const others=Object.values(d.users).filter(u=>u.id!==id&&u.role==='superadmin'&&u.is_active&&d.mfa[u.id]?.enabled);
    if(!others.length)throw appError('The last active Superadmin cannot be removed, disabled or demoted.',409);
  }
  Object.assign(user,{role:input.role,is_active:id&&input.is_active!==undefined?Boolean(input.is_active):true});
  d.grants[id]=input.role==='superadmin'?[]:input.domains;d.teams[id]=['editor','viewer'].includes(input.role)?manager:null;rotateAccess(user);
  // A manager losing a website must not retain control over members outside it.
  for(const [member,managerId]of Object.entries(d.teams))if(managerId===id){
    const previous=d.grants[member]||[];
    const next=user.is_active&&user.role==='superadmin'?previous:user.is_active&&user.role==='admin'?previous.filter(k=>d.grants[id].includes(k)):[];
    if(next.length!==previous.length){d.grants[member]=next;rotateAccess(d.users[member]);}
    if(user.role!=='admin'||!user.is_active)d.teams[member]=null;
  }
  return id;
}
export function installPlatformUsers(app,{accounts,pool,security}){
  const {requireAdmin}=security;
  const active=(req,res,next)=>req.auth.platform_enabled?next():next('route');
  const admin=(req,res,next)=>['admin','superadmin'].includes(req.auth.role)?next():res.status(403).json({ok:false,message:'Administrator access is required.'});
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||503).json({ok:false,message:e.status?e.message:'User management is temporarily unavailable.'});}};
  const offset=req=>Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
  app.get('/api/users',requireAdmin,active,admin,wrap(async(req,res)=>{const d=await accounts.platformRead();res.json({ok:true,data:managedUsers(d,req.auth).map(u=>publicUser(d,u,req.auth))});}));
  for(const [method,path]of [['post','/api/users'],['patch','/api/users/:id']])app[method](path,requireAdmin,active,admin,(req,res,next)=>security.requireFresh(req,res,next),wrap(async(req,res)=>{
    const input=req.body||{};let passwordHash;
    if(method==='post'){if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)throw appError('Use a password of 12-128 characters.');passwordHash=await hashPassword(input.password);}
    const [domains]=await pool.query('SELECT domain_key FROM domains WHERE user_id=1');
    const id=await accounts.platformAtomic(d=>changeManagedUser(d,req.auth,input,method==='patch'?Number(req.params.id):null,passwordHash,domains.map(d=>d.domain_key)));
    res.status(method==='post'?201:200).json({ok:true,data:{id},message:'Access saved. Previous sessions for the changed user were revoked.'});
  }));
  app.get('/api/users/login-attempts',requireAdmin,active,admin,wrap(async(req,res)=>{const d=await accounts.platformRead(),ids=managedUsers(d,req.auth).map(u=>u.id);res.json({ok:true,data:await accounts.platformAttempts(req.auth.role==='superadmin'?null:ids,offset(req),req.auth)});}));
  const canView=async req=>{const d=await accounts.platformRead();if(!managedUsers(d,req.auth).some(u=>u.id===Number(req.params.id)))throw appError('User is unavailable.',404);};
  app.get('/api/users/:id/sessions',requireAdmin,active,admin,wrap(async(req,res)=>{await canView(req);const rows=await accounts.sessions(Number(req.params.id),offset(req));res.json({ok:true,data:rows.map(r=>({id:r.id,current:r.id===req.auth.sid,login_ms:Number(r.login_ms),last_seen_ms:Number(r.last_seen_ms),expires_ms:Number(r.expires_ms),ended_ms:r.ended_ms?Number(r.ended_ms):null,status:r.ended_ms?'ended':r.expires_ms<=Date.now()?'expired':'active',end_reason:r.end_reason,ip_address:r.ip_address,device:r.device,browser:r.browser,os:r.os}))});}));
  app.delete('/api/users/:id/sessions/:session',requireAdmin,active,admin,(req,res,next)=>security.requireFresh(req,res,next),wrap(async(req,res)=>{await canView(req);const ended=await accounts.endSession(req.params.session,Number(req.params.id),'admin_revoked');res.status(ended?200:404).json({ok:ended,message:ended?'Session revoked.':'Session unavailable.'});}));
}
