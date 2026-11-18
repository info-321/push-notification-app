import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {requestVisitorIp} from './audience.js';
import {verifyPassword} from './accounts.js';
import {platformCrypto,newMfa,totp,consumeMfa,recoveryCodes,fingerprint,requestFingerprint,appError} from './platform-crypto.js';
import {assertActor,rotateAccess} from './platform-store.js';

export const mfaRequired=(state,user)=>Boolean(state.mfa_enabled||(state.enabled&&(user.role==='superadmin'||user.role==='admin'&&state.policy.require_admin_mfa)));
export function installPlatformAuth(app,{accounts,security,secret}){
  const {requireAdmin,browser,createToken}=security,crypt=platformCrypto(secret);
  const limited=async req=>{
    for(const [kind,value,max]of [['user',req.auth.id,10],['ip',requestVisitorIp(req)||'unknown',30]])if(!await accounts.recoveryLimit(fingerprint(`mfa:${kind}:${value}`),max))throw appError('Too many security attempts. Try again in 15 minutes.',429);
  };
  const route=(path,handler)=>app.post(path,requireAdmin,async(req,res)=>{try{await limited(req);return await handler(req,res);}catch(e){if(e.status===429)res.set('Retry-After','900');res.status(e.status||503).json({ok:false,code:e.code,message:e.status?e.message:'Security settings are temporarily unavailable.'});}});
  const renew=async(req,res)=>{await accounts.endOthers(req.auth.id,null,'mfa_changed');const user=await accounts.read(req.auth.id);const token=await createToken(user.session_version,user.id,req,{mfa_verified:true,factor_ms:Date.now()});return browser.issue(res,token);};
  app.get('/api/account/mfa',requireAdmin,async(req,res)=>{try{const data=await accounts.platformRead(),m=data.mfa[req.auth.id];res.json({ok:true,data:{username:req.auth.username,enabled:Boolean(m?.enabled),required:Boolean(data.state.enabled&&(req.auth.role==='superadmin'||req.auth.role==='admin'&&data.state.policy.require_admin_mfa)),recovery_remaining:m?.recovery?.length||0,pending:!req.auth.full_access}});}catch{res.status(503).json({ok:false,message:'Could not load two-factor settings.'});}});
  route('/api/account/mfa/start',async(req,res)=>{
    const seed=newMfa();
    await accounts.platformAtomic(async d=>{const u=assertActor(d,req.auth);if(!await verifyPassword(req.body?.password,u.password_hash))throw appError('Current password is incorrect.');if(d.mfa[u.id]?.enabled)throw appError('Two-factor authentication is already enabled.');d.mfa[u.id]={user_id:u.id,enabled:false,pending_cipher:crypt.encrypt(seed,`mfa:${u.id}`),pending_expires_ms:Date.now()+600000,last_counter:-1,recovery:[]};});
    const uri=totp(seed,req.auth.username).toString();res.json({ok:true,data:{secret:seed,qr:await QRCode.toDataURL(uri,{width:240,margin:2}),expires_minutes:10}});
  });
  route('/api/account/mfa/enable',async(req,res)=>{
    const codes=recoveryCodes(crypt,req.auth.id);
    await accounts.platformAtomic(async d=>{const u=assertActor(d,req.auth),m=d.mfa[u.id];if(!await verifyPassword(req.body?.password,u.password_hash))throw appError('Current password is incorrect.');if(m?.enabled||!m?.pending_cipher||m.pending_expires_ms<=Date.now())throw appError('Start two-factor setup again.');
      const candidate={enabled:true,secret_cipher:m.pending_cipher,last_counter:-1,recovery:[]};if(!consumeMfa(candidate,req.body?.code,crypt,u.id))throw appError('Enter the current six-digit authenticator code.');
      d.mfa[u.id]={...candidate,user_id:u.id,recovery:codes.hashes,pending_cipher:null,pending_expires_ms:null};rotateAccess(u);
    });
    const csrfToken=await renew(req,res);res.json({ok:true,csrfToken,data:{recovery_codes:codes.codes},message:'Two-factor authentication enabled. Save these recovery codes privately.'});
  });
  route('/api/auth/mfa/verify',async(req,res)=>{
    await accounts.platformAtomic(d=>{const u=assertActor(d,req.auth);if(!consumeMfa(d.mfa[u.id],req.body?.code,crypt,u.id))throw appError('The code is invalid or already used. Try the next authenticator code or a recovery code.');});
    await accounts.endSession(req.auth.sid,req.auth.id,'mfa_verified');const u=await accounts.read(req.auth.id),token=await createToken(u.session_version,u.id,req,{mfa_verified:true,factor_ms:Date.now()});res.json({ok:true,csrfToken:browser.issue(res,token)});
  });
  for(const action of ['disable','recovery-codes'])route(`/api/account/mfa/${action}`,async(req,res)=>{
    const codes=recoveryCodes(crypt,req.auth.id);
    await accounts.platformAtomic(async d=>{const u=assertActor(d,req.auth);if(!await verifyPassword(req.body?.password,u.password_hash)||!consumeMfa(d.mfa[u.id],req.body?.code,crypt,u.id))throw appError('Enter your current password and an unused authenticator or recovery code.');
      if(action==='disable'&&d.state.enabled&&(u.role==='superadmin'||u.role==='admin'&&d.state.policy.require_admin_mfa))throw appError('This role must keep two-factor authentication enabled.');
      d.mfa[u.id]=action==='disable'?{user_id:u.id,enabled:false,last_counter:-1,recovery:[]}:{...d.mfa[u.id],recovery:codes.hashes};rotateAccess(u);
    });
    res.json({ok:true,csrfToken:await renew(req,res),data:action==='disable'?{}:{recovery_codes:codes.codes},message:action==='disable'?'Two-factor authentication disabled.':'New recovery codes generated. Previous codes no longer work.'});
  });
  route('/api/account/step-up',async(req,res)=>{
    const target=req.body?.request;
    if(!target||!['POST','PUT','PATCH','DELETE'].includes(target.method)||typeof target.path!=='string'||!/^\/api\/(platform|users|domains)(?:\/[^?#\s]*)?$/.test(target.path)||target.path.length>250||!target.body||typeof target.body!=='object'||Array.isArray(target.body))throw appError('Choose a valid protected action.');
    const raw=crypto.randomBytes(32).toString('base64url');
    await accounts.platformAtomic(async d=>{const u=assertActor(d,req.auth);if(!await verifyPassword(req.body?.password,u.password_hash))throw appError('Current password is incorrect.');if(d.mfa[u.id]?.enabled&&!consumeMfa(d.mfa[u.id],req.body?.code,crypt,u.id))throw appError('Enter an unused authenticator or recovery code.');
      if(u.role==='superadmin'&&!d.mfa[u.id]?.enabled)throw appError('Enable two-factor authentication first.',403);
      const hash=fingerprint(raw);d.approvals[hash]={token_hash:hash,user_id:u.id,session_id:req.auth.sid,session_version:u.session_version,request_hash:fingerprint({method:target.method,path:target.path,body:target.body}),expires_ms:Date.now()+300000,used_ms:null};
    });res.json({ok:true,approval:raw});
  });
  security.requireFresh=async(req,res,next)=>{
    if(!req.auth.platform_enabled)return next();
    try{const raw=req.get('X-Notizo-Approval');if(typeof raw!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw appError('Confirm your password and two-factor code before this action.',403,'STEP_UP_REQUIRED');
      await accounts.platformAtomic(d=>{const u=assertActor(d,req.auth),a=d.approvals[fingerprint(raw)];if(!a||a.used_ms||a.expires_ms<=Date.now()||Number(a.user_id)!==u.id||a.session_id!==req.auth.sid||a.session_version!==u.session_version||a.request_hash!==requestFingerprint(req))throw appError('This confirmation expired or does not match the action. Confirm again.',403,'STEP_UP_REQUIRED');a.used_ms=Date.now();});next();
    }catch(e){res.status(e.status||503).json({ok:false,code:e.code,message:e.status?e.message:'Could not verify this action.'});}
  };
}
