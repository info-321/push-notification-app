import crypto from 'node:crypto';
import {assertActor} from './platform-store.js';
import {appError} from './platform-crypto.js';
import {senderKeyFor} from './platform-services.js';
const csv=(value,field)=>{
  let text=String(value??'');
  const credential=['p256dh','auth'].includes(field)&&/^[A-Za-z0-9_-]+$/.test(text);
  if(typeof value!=='number'&&!credential&&/^[=+@\t\r-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
};
export function installPlatformRoutes(app,{accounts,pool,security,mailer,secret}){
  const {requireAdmin}=security;
  const owner=(req,res,next)=>req.auth.role==='superadmin'&&req.auth.platform_enabled?next():res.status(403).json({ok:false,message:'Superadmin access is required.'});
  const fresh=(req,res,next)=>security.requireFresh(req,res,next);
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(res.headersSent){res.destroy();return;}res.status(e.status||503).json({ok:false,message:e.status?e.message:'Platform administration is temporarily unavailable.'});}};
  app.get('/api/domains/:key/sending-control',requireAdmin,wrap(async(req,res)=>{const state=await accounts.platformStatus();res.json({ok:true,data:{enabled:state.enabled,paused:await accounts.platformConfig(`pause:${req.params.key}`)==='true',global_paused:state.sends_paused,may_pause:['admin','superadmin'].includes(req.auth.role)}});}));
  app.patch('/api/domains/:key/sending-control',requireAdmin,fresh,wrap(async(req,res)=>{
    if(!req.auth.platform_enabled||!['admin','superadmin'].includes(req.auth.role))throw appError('Administrator access is required.',403);
    if(typeof req.body?.paused!=='boolean')throw appError('Choose a sending state.');
    await accounts.platformAtomic(d=>{const u=assertActor(d,req.auth);if(u.role!=='superadmin'&&!(d.grants[u.id]||[]).includes(req.params.key))throw appError('Website unavailable.',403);d.config[`pause:${req.params.key}`]=String(req.body.paused);});
    res.json({ok:true,message:req.body.paused?'Sending paused for this website.':'Website sending resumed. Global pauses still take priority.'});
  }));
  app.use('/api/platform',requireAdmin,owner);
  app.get('/api/platform',wrap(async(req,res)=>{
    const d=await accounts.platformRead();const [domains]=await pool.query(`SELECT d.id,d.domain_key,d.domain_name,d.display_name,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.domain_key=d.domain_key AND s.user_id=1) AS subscribers FROM domains d WHERE d.user_id=1 ORDER BY d.domain_name`);
    const [maintenance]=await pool.query('SELECT id,started_ms,finished_ms,status FROM maintenance_runs ORDER BY started_ms DESC LIMIT 5');
    res.json({ok:true,data:{state:d.state,users:Object.values(d.users).map(u=>({id:u.id,username:u.username,role:u.role,is_active:Boolean(u.is_active),domains:d.grants[u.id]||[],mfa_enabled:Boolean(d.mfa[u.id]?.enabled)})),domains,smtp:await mailer.publicSettings(),maintenance,operations:Object.values(d.operations).sort((a,b)=>b.created_ms-a.created_ms).map(o=>({...o,details:Object.fromEntries(Object.entries(o.details).filter(([key])=>key!=='authorizer_version'))})),audit_records_protected:true}});
  }));
  app.post('/api/platform/policy',fresh,wrap(async(req,res)=>{
    const p=req.body;if(!p||Object.keys(p).some(k=>!['session_hours','require_admin_mfa','subscriber_exports'].includes(k))||!Number.isSafeInteger(p.session_hours)||p.session_hours<1||p.session_hours>24||typeof p.require_admin_mfa!=='boolean'||typeof p.subscriber_exports!=='boolean')throw appError('Choose 1-24 session hours and valid security policy options.');
    await accounts.platformAtomic(d=>{assertActor(d,req.auth);d.state.policy=p;});res.json({ok:true,message:'Platform security policy updated.'});
  }));
  app.post('/api/platform/pause',fresh,wrap(async(req,res)=>{if(typeof req.body?.paused!=='boolean')throw appError('Choose whether sending is paused.');await accounts.platformAtomic(d=>{assertActor(d,req.auth);d.state.sends_paused=req.body.paused;});res.json({ok:true,message:req.body.paused?'All website sending is paused. Requests already in flight may finish their current batch.':'Platform sending resumed. Review interrupted schedules before retrying.'});}));
  for(const action of ['test','save'])app.post(`/api/platform/smtp/${action}`,fresh,wrap(async(req,res)=>{
    const s=await mailer.candidate(req.body);
    try{await mailer.verify(s);}catch{throw appError('SMTP connection failed. Check the provider settings, credentials and outbound access. Existing settings are unchanged.',400);}
    if(action==='save')await accounts.platformAtomic(d=>{assertActor(d,req.auth);d.config.smtp=mailer.encrypt(s);});
    res.json({ok:true,message:action==='test'?'SMTP settings verified. No email was sent.':'SMTP settings verified and saved. The password stays hidden.'});
  }));
  for(const action of ['reveal','rotate'])app.post(`/api/platform/domains/:key/sender-key/${action}`,fresh,wrap(async(req,res)=>{
    const [rows]=await pool.query('SELECT domain_key FROM domains WHERE domain_key=? AND user_id=1',[req.params.key]);if(!rows.length)throw appError('Website unavailable.',404);
    if(action==='rotate')await accounts.platformAtomic(d=>{assertActor(d,req.auth);d.config[`sender:${req.params.key}`]=String(Number(d.config[`sender:${req.params.key}`]||0)+1);});
    res.json({ok:true,data:{sender_api_key:await senderKeyFor(accounts,secret,req.params.key)},message:action==='rotate'?'Sender key rotated. Update the WordPress integration for this website. Subscriber VAPID keys were preserved.':'Copy this sender key privately into the website integration.'});
  }));
  app.post('/api/platform/exports/subscribers',fresh,wrap(async(req,res)=>{
    const {domain_key:key,reason,include_location=false}=req.body||{};
    if(typeof key!=='string'||typeof reason!=='string'||reason.trim().length<10||reason.length>500||typeof include_location!=='boolean')throw appError('Choose a website and enter a reason of 10-500 characters.');
    const state=await accounts.platformStatus();if(!state.policy.subscriber_exports)throw appError('Subscriber exports are disabled in platform security policy.',403);
    const [sites]=await pool.query('SELECT domain_key FROM domains WHERE domain_key=? AND user_id=1',[key]);if(!sites.length)throw appError('Website unavailable.',404);
    const id=crypto.randomUUID();await accounts.platformAtomic(d=>{assertActor(d,req.auth);d.operations[id]={id,kind:'subscriber_export',status:'approved',actor_id:req.auth.id,created_ms:Date.now(),details:{domain_key:key,reason:reason.trim(),include_location}};});
    const [[end]]=await pool.query('SELECT COALESCE(MAX(id),0) AS last FROM subscriptions WHERE domain_key=? AND user_id=1',[key]);
    const fields=['id','endpoint','p256dh','auth','country_code','region_name','city_name','device_type','browser_family','created_at',...(include_location?['ip_address','latitude','longitude','location_accuracy_m']:[])];
    res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="notizo-subscribers.csv"','X-Content-Type-Options':'nosniff'});res.write(fields.map(csv).join(',')+'\r\n');
    let after=0;while(!res.destroyed){const [rows]=await pool.query(`SELECT ${fields.join(',')} FROM subscriptions WHERE domain_key=? AND user_id=1 AND id>? AND id<=? ORDER BY id LIMIT 500`,[key,after,end.last]);if(!rows.length)break;
      for(const row of rows){if(res.destroyed)return;if(!res.write(fields.map(f=>csv(row[f],f)).join(',')+'\r\n'))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});after=row.id;}
    }if(!res.destroyed)res.end();
  }));
  app.post('/api/platform/restore-approvals',fresh,wrap(async(req,res)=>{
    const {backup_id,reason}=req.body||{};if(typeof backup_id!=='string'||typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw appError('Choose a recorded backup and give a reason of 10-500 characters.');
    const id=crypto.randomUUID();await accounts.platformAtomic(d=>{assertActor(d,req.auth);const backup=d.operations[backup_id];if(backup?.kind!=='backup'||backup.status!=='completed')throw appError('Choose a completed backup from the backup catalog.');d.operations[id]={id,kind:'restore',status:'approved',actor_id:req.auth.id,created_ms:Date.now(),details:{...backup.details,reason:reason.trim(),authorizer_version:req.auth.version}};});res.json({ok:true,data:{id},message:'Restore approved and recorded. A Hostinger operator must verify this exact backup and perform the coordinated restore; the live database has not been overwritten.'});
  }));
}
