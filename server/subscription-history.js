import crypto from 'node:crypto';
import { endpointWhere, endpointParams } from './storage-maintenance.js';
export async function ensureSubscriptionHistory(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS subscription_history_state (id INT PRIMARY KEY,started_ms BIGINT NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS subscription_events (
    event_key VARCHAR(96) PRIMARY KEY, domain_key VARCHAR(64) NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
    subscription_id BIGINT UNSIGNED NOT NULL, event_type VARCHAR(24) NOT NULL, occurred_ms BIGINT NOT NULL,
    device_type VARCHAR(16) NULL, browser_family VARCHAR(32) NULL,
    KEY subscription_event_period(domain_key,user_id,occurred_ms))`);
  await pool.query('INSERT IGNORE INTO subscription_history_state (id,started_ms) VALUES (1,?)',[Date.now()]);
  await pool.query(`INSERT IGNORE INTO subscription_events (event_key,domain_key,user_id,subscription_id,event_type,occurred_ms,device_type,browser_family)
    SELECT CONCAT('subscribe:',id),domain_key,user_id,id,'baseline',CAST(UNIX_TIMESTAMP(created_at)*1000 AS UNSIGNED),device_type,browser_family FROM subscriptions WHERE COALESCE(p256dh,'')<>'' AND COALESCE(auth,'')<>''`);
  pool.notizoLifecycle=true;
}
export async function subscriptionTransaction(pool, action) {
  if(!pool.notizoLifecycle)return action(pool);
  const c=await pool.getConnection();
  try{await c.beginTransaction();const result=await action(c);await c.commit();return result;}catch(error){await c.rollback();throw error;}finally{c.release();}
}
export async function recordSubscriptionAdded(pool,connection,row) {
  if(!pool.notizoLifecycle)return;
  await connection.query('INSERT INTO subscription_events (event_key,domain_key,user_id,subscription_id,event_type,occurred_ms,device_type,browser_family) VALUES (?,?,?,?,?,?,?,?)',
    [`subscribe:${row.id}`,row.domain_key,row.user_id,row.id,'added',Date.now(),row.device_type,row.browser_family]);
}
export async function removeSubscription(pool,id,key,reason='expired',proof=null) {
  if(!pool.notizoLifecycle){await pool.query('DELETE FROM subscriptions WHERE id = ? AND domain_key = ?',[id,key]);return true;}
  return subscriptionTransaction(pool,async c=>{
    const [rows]=await c.query('SELECT id,user_id,domain_key,device_type,browser_family,p256dh,auth FROM subscriptions WHERE id=? AND domain_key=? FOR UPDATE',[id,key]);
    if(!rows.length)return false;
    const row=rows[0];
    if(proof&&!['p256dh','auth'].every(field=>typeof proof[field]==='string'&&row[field]===proof[field]))return false;
    await c.query('INSERT IGNORE INTO subscription_events (event_key,domain_key,user_id,subscription_id,event_type,occurred_ms,device_type,browser_family) VALUES (?,?,?,?,?,?,?,?)',
      [`remove:${id}`,key,row.user_id,id,reason,Date.now(),row.device_type,row.browser_family]);
    await c.query('DELETE FROM subscriptions WHERE id = ? AND domain_key = ?',[id,key]);return true;
  });
}
export async function recordDomainRemovals(pool,c,key) {
  if(pool.notizoLifecycle)await c.query(`INSERT IGNORE INTO subscription_events (event_key,domain_key,user_id,subscription_id,event_type,occurred_ms,device_type,browser_family)
    SELECT CONCAT('remove:',id),domain_key,user_id,id,'domain_deleted',?,device_type,browser_family FROM subscriptions WHERE domain_key=? AND user_id=1`,[Date.now(),key]);
}
export function installUnsubscribe(app,{pool,requireAdmin}) {
  app.get('/api/domains/:key/subscription-history',requireAdmin,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const event=req.query.event;
    if(event!==undefined&&!['added','baseline','unsubscribed','expired','domain_deleted'].includes(event))return res.status(400).json({ok:false,message:'Choose a valid subscription event.'});
    try{const offset=Math.max(0,Math.min(100000,Number.parseInt(req.query.offset,10)||0));
      const [owned]=await pool.query('SELECT domain_key FROM domains WHERE domain_key=? AND user_id=1',[req.params.key]);
      if(!owned.length)return res.status(404).json({ok:false,message:'Website not found.'});
      const [rows]=await pool.query(`SELECT event_key,subscription_id,event_type,occurred_ms,device_type,browser_family FROM subscription_events WHERE domain_key=? AND user_id=1${event?' AND event_type=?':''} ORDER BY occurred_ms DESC,event_key LIMIT 50 OFFSET ?`,[req.params.key,...(event?[event]:[]),offset]);
      const [[state]]=await pool.query('SELECT started_ms FROM subscription_history_state WHERE id=1');
      res.json({ok:true,data:{rows:rows.map(row=>({...row,occurred_ms:Number(row.occurred_ms)})),started_ms:Number(state.started_ms)}});
    }catch{res.status(503).json({ok:false,message:'Could not load subscription history.'});}
  });
  app.post('/api/subscriptions/unsubscribe',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {domain_key:key,subscription}=req.body || {};
    if(typeof key!=='string'||typeof subscription?.endpoint!=='string'||subscription.endpoint.length>2048||typeof subscription.keys?.p256dh!=='string'||typeof subscription.keys?.auth!=='string')return res.status(400).json({ok:false,message:'A browser subscription is required.'});
    if(!/^[A-Za-z0-9_-]+$/.test(subscription.keys.p256dh)||Buffer.from(subscription.keys.p256dh,'base64url').length!==65||!/^[A-Za-z0-9_-]+$/.test(subscription.keys.auth)||Buffer.from(subscription.keys.auth,'base64url').length!==16)return res.status(400).json({ok:false,message:'Valid subscription credentials are required.'});
    try{
      const [domains]=await pool.query('SELECT domain_name FROM domains WHERE domain_key=? AND user_id=1',[key]);
      let origin;try{origin=new URL(req.get('Origin'));}catch{}
      if(!domains.length||!origin||origin.hostname.replace(/^www\./,'')!==domains[0].domain_name.replace(/^www\./,'')||(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname)))return res.status(403).json({ok:false,message:'Website does not match this subscription.'});
      // Withdrawal is allowed even when new targeting rules exclude this browser.
      const [rows]=await pool.query(`SELECT id,p256dh,auth FROM subscriptions WHERE ${endpointWhere(pool)} AND domain_key=? AND user_id=1`,[...endpointParams(pool,subscription.endpoint),key]);
      if(!rows.length)return res.json({ok:true});
      const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
      if(!equal(rows[0].p256dh,subscription.keys.p256dh)||!equal(rows[0].auth,subscription.keys.auth))return res.status(403).json({ok:false,message:'Subscription credentials do not match.'});
      const ok=await removeSubscription(pool,rows[0].id,key,'unsubscribed',subscription.keys);
      return res.status(ok?200:409).json({ok,message:ok?'Unsubscribed.':'Subscription changed. Reload before trying again.'});
    }catch(error){console.error('Unsubscribe storage failed:',error.code);res.status(503).json({ok:false,message:'Could not update the server. Please try again.'});}
  });
}
