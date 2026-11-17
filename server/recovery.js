import crypto from 'node:crypto';
import {hashPassword,verifyPassword} from './accounts.js';
import {loginMetadata} from './security.js';
import {validMailbox} from './mail.js';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const validToken=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t);
export function installRecoveryRoutes(app,{accounts,requireAdmin,browser,mailer={enabled:false},secret,dashboardBase}) {
  const base=new URL(dashboardBase);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Recovery links require HTTPS.');
  const limit=async(req,label,value,max)=>accounts.recoveryLimit(crypto.createHmac('sha256',secret).update(`recovery:${label}:${value}`).digest('hex'),max);
  const rate=async(req,res,next)=>{try{if(!await limit(req,'ip',loginMetadata(req).ip_address||'unknown',30))return res.set('Retry-After','900').status(429).json({ok:false,message:'Too many requests. Try again in 15 minutes.'});next();}catch{res.status(503).json({ok:false,message:'Recovery is temporarily unavailable.'});}};
  const send=async(row,purpose,email)=>{
    const token=crypto.randomBytes(32).toString('base64url'),hash=digest(token);
    if(!await accounts.issueRecovery({user_id:Number(row.id),purpose,email,token_hash:hash,session_version:row.session_version,expires_ms:Date.now()+(purpose==='verify'?30:15)*60000}))return;
    // Fragment stays out of HTTP access logs and Referer. Client removes it immediately.
    const url=new URL('/login',base);url.hash=new URLSearchParams({[purpose==='verify'?'verify':'reset']:token}).toString();
    try{await mailer.send({to:email,purpose,url:url.href});}catch{await accounts.discardRecovery(hash);throw new Error('Email delivery failed.');}
  };
  app.get('/api/account/recovery',requireAdmin,async(req,res)=>{try{res.json({ok:true,data:{...await accounts.recovery(req.auth.id),mail_enabled:mailer.enabled}});}catch{res.status(503).json({ok:false,message:'Could not load recovery settings.'});}});
  app.post('/api/account/recovery',requireAdmin,rate,async(req,res)=>{
    if(!mailer.enabled)return res.status(503).json({ok:false,message:'Email delivery is not configured. Ask your administrator to finish SMTP setup.'});
    const {email,password}=req.body||{};
    if(!validMailbox(email))return res.status(400).json({ok:false,message:'Enter a valid recovery email address.'});
    try{
      if(!await limit(req,'verify-user',req.auth.id,5))return res.set('Retry-After','900').status(429).json({ok:false,message:'Wait 15 minutes before requesting another verification email.'});
      const row=await accounts.read(req.auth.id);
      if(!await verifyPassword(password,row.password_hash))return res.status(400).json({ok:false,message:'Current password is incorrect.'});
      await send(row,'verify',email.toLowerCase());res.json({ok:true,message:'Check your inbox and open the verification link. Your previous recovery email stays active until the new one is verified.'});
    }catch{res.status(503).json({ok:false,message:'Verification email could not be sent. Check SMTP setup and try again.'});}
  });
  app.post('/api/auth/verify-email',browser.guard,rate,async(req,res)=>{
    try{const ok=validToken(req.body?.token)&&await accounts.redeemRecovery(digest(req.body.token),'verify');res.status(ok?200:400).json({ok:Boolean(ok),message:ok?'Recovery email verified. You can now use Forgot password.':'This verification link is invalid, expired or already used.'});}catch{res.status(503).json({ok:false,message:'Verification is temporarily unavailable.'});}
  });
  app.post('/api/auth/forgot-password',browser.guard,rate,async(req,res)=>{
    if(!mailer.enabled)return res.status(503).json({ok:false,message:'Password-reset email is not configured yet. Contact your administrator for help.'});
    const username=req.body?.username;
    if(typeof username!=='string'||!username.trim()||username.length>255)return res.status(400).json({ok:false,message:'Enter your username.'});
    // Respond independently of account existence and SMTP latency. Work remains
    // rate-limited in MySQL; a restart may require the visitor to request again.
    setImmediate(async()=>{try{if(await limit(req,'reset-user',username.trim().toLowerCase(),3)){
      const row=await accounts.find(username.trim());
      if(row?.is_active){const r=await accounts.recovery(row.id);if(r.verified_email)await send(row,'reset',r.verified_email);}
    }}catch{console.error('Recovery request failed; check database and SMTP configuration.');}});
    return res.status(202).json({ok:true,message:'If this account has a verified recovery email, a reset link will arrive shortly. It expires in 15 minutes. Otherwise, contact your administrator.'});
  });
  app.post('/api/auth/reset-password',browser.guard,rate,async(req,res)=>{
    const {token,password}=req.body||{};
    if(!validToken(token)||typeof password!=='string'||password.length<12||password.length>128)return res.status(400).json({ok:false,message:'Use a valid reset link and a password of 12-128 characters.'});
    try{const ok=await accounts.redeemRecovery(digest(token),'reset',await hashPassword(password));if(!ok)return res.status(400).json({ok:false,message:'This reset link is invalid, expired or already used. Request a new link.'});browser.clear(res);await accounts.audit({actor_id:ok.user_id,actor_name:'Account recovery',action:'password_reset',method:'POST',domain_key:null});res.json({ok:true,message:'Password reset. All previous sessions are signed out. Sign in with your new password.'});}catch{res.status(503).json({ok:false,message:'Password reset is temporarily unavailable.'});}
  });
}
