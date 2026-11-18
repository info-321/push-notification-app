import crypto from 'node:crypto';

export const accountEventKinds=['account_created','account_access_changed','password_changed','password_reset_requested','password_reset_completed'];
const passwordKinds=new Set(['password_changed','password_reset_requested','password_reset_completed']);
const summaryKey=id=>`account-audit:${Number(id)}`;
export function accountEvent(kind,actor,target,{source='dashboard',reason,changes,requestedBy}={}){
  if(!accountEventKinds.includes(kind))throw new Error('Unsupported account event.');
  // Explicit metadata only. Never copy a request body or credential into a log.
  const details={target_id:Number(target.id),target_username:target.username,actor_name:actor.username,source};
  if(reason)details.reason=reason;
  if(requestedBy)details.requested_by={id:Number(requestedBy.id),username:requestedBy.username};
  if(changes)details.changes={role:changes.role,is_active:changes.is_active,domains:changes.domains,manager_id:changes.manager_id};
  return {id:crypto.randomUUID(),kind,status:'completed',actor_id:Number(actor.id)||0,created_ms:Date.now(),details};
}
function summaryInfo(event){return {time_ms:event.created_ms,actor_id:event.actor_id,actor_name:event.details.actor_name,source:event.details.source,kind:event.kind};}
export function addAccountEvent(data,event){
  data.operations[event.id]=event;
  if(event.kind!=='account_created'&&!passwordKinds.has(event.kind))return;
  const key=summaryKey(event.details.target_id),summary=JSON.parse(data.config[key]||'{}');
  if(event.kind==='account_created')summary.created ||= summaryInfo(event);
  else summary.password=summaryInfo(event);
  data.config[key]=JSON.stringify(summary);
}
export async function insertAccountEvent(connection,event){
  await connection.query('INSERT INTO platform_operations (id,kind,status,actor_id,created_ms,details) VALUES (?,?,?,?,?,?)',[event.id,event.kind,event.status,event.actor_id,event.created_ms,JSON.stringify(event.details)]);
  const field=event.kind==='account_created'?'created':passwordKinds.has(event.kind)?'password':null;
  if(!field)return;
  const info=JSON.stringify(summaryInfo(event)),value=JSON.stringify({[field]:summaryInfo(event)});
  const replacement=field==='created'?`COALESCE(JSON_EXTRACT(value,'$.created'),CAST(? AS JSON))`:'CAST(? AS JSON)';
  await connection.query(`INSERT INTO platform_config (name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=JSON_SET(value,'$.${field}',${replacement})`,[summaryKey(event.details.target_id),value,info]);
}
export function accountSummaries(users,config){return users.map(u=>{
  const summary=JSON.parse(config[summaryKey(u.id)]||'{}');
  const previous=u.password_changed_at?new Date(u.password_changed_at).getTime():null;
  return {id:Number(u.id),username:u.username,role:u.role,is_active:Boolean(u.is_active),created:summary.created||null,password:summary.password||(Number.isFinite(previous)&&previous?{time_ms:previous,actor_name:null,source:'legacy_record',kind:'password_changed'}:null)};
});}
export function publicAccountEvent(event){
  const d=typeof event.details==='string'?JSON.parse(event.details):event.details;
  return {id:event.id,kind:event.kind,time_ms:Number(event.created_ms),actor_id:Number(event.actor_id),actor_name:d.actor_name||'Not recorded',target_id:Number(d.target_id),target_username:d.target_username,source:d.source,reason:d.reason||null,changes:d.changes||null,requested_by:d.requested_by||null};
}
export const isAccountEvent=event=>accountEventKinds.includes(event.kind);
