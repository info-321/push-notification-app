import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createApp} from '../app.js';
import {memoryAccountRepository,hashPassword,createAdminToken} from '../accounts.js';
import {activatePlatform} from '../platform-bootstrap.js';
import {changeManagedUser} from '../platform-users.js';
import {platformCrypto,totp,consumeMfa,newMfa,recoveryCodes} from '../platform-crypto.js';
import {managedMailer,senderKeyFor} from '../platform-services.js';
import {tokenHash} from '../identity-store.js';
const password='Fixture-password-123',secret='platform-fixture-key-not-production';
async function fixture(t){
  const accounts=memoryAccountRepository('Superadmin',password),hash=await hashPassword(password);
  const admin=await accounts.createUser({username:'Admin',password_hash:hash,role:'admin',domains:[]});
  const editor=await accounts.createUser({username:'Editor',password_hash:hash,role:'editor',domains:['one']});
  const viewer=await accounts.createUser({username:'Viewer',password_hash:hash,role:'viewer',domains:['two']});
  await accounts.platformAtomic(d=>{activatePlatform(d,{username:'Superadmin',assignments:{[admin]:['one']},domainKeys:['one','two']});d.teams[editor]=admin;});
  const domains=[{id:1,user_id:1,domain_key:'one',domain_name:'one.test',display_name:'One',vapid_private_key:'fixture-vapid-private',vapid_public_key:'fixture-vapid-public',subscribers:2},{id:2,user_id:1,domain_key:'two',domain_name:'two.test',subscribers:0}],messages=[],queries=[];
  const pool={query:async(sql,p=[])=>{queries.push(sql);
    if(sql.includes('FROM maintenance_runs'))return [[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM domains')){if(sql.includes('WHERE id=?'))return [domains.filter(d=>d.id===p[0])];if(sql.includes('domain_key=?')||sql.includes('domain_key = ?'))return [domains.filter(d=>d.domain_key===p[0])];return [domains];}
    if(sql.includes('MAX(id)'))return [[{last:2}]];
    if(sql.includes('FROM subscriptions')&&sql.includes('LIMIT 500'))return [p[1]===0?[{id:1,endpoint:'https://fcm.googleapis.com/fcm/send/fixture',p256dh:'public-encoded',auth:'-auth-encoded',country_code:'IN'}]:[]];
    throw new Error('Unexpected fixture query: '+sql);
  }};
  const server=createApp({pool,accountRepository:accounts,webpush:{sendNotification:async()=>{throw new Error('No live sends');}},secret,publicApiBase:'https://api.test',mailer:{enabled:true,send:async row=>messages.push(row)}}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});const base=`http://127.0.0.1:${server.address().port}`;
  function client(){let cookies=new Map(),csrf='';return {
    async call(path,body,method=body?'POST':'GET',extra={}){const r=await fetch(base+path,{method,headers:{Origin:'https://api.test','Content-Type':'application/json',Cookie:[...cookies.values()].join('; '),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});for(const item of r.headers.getSetCookie()){const pair=item.split(';')[0];cookies.set(pair.split('=')[0],pair);}const csv=r.headers.get('Content-Type')?.includes('text/csv'),data=csv?await r.text():await r.json();if(data.csrfToken)csrf=data.csrfToken;return {status:r.status,data};},
    async login(username='Superadmin'){await this.call('/api/auth/session');return this.call('/api/login',{username,password});},
  };}
  const owner=client();await owner.login();
  async function enroll(c=owner){const s=await c.call('/api/account/mfa/start',{password});assert.equal(s.status,200);const code=totp(s.data.data.secret).generate(),result=await c.call('/api/account/mfa/enable',{password,code});assert.equal(result.status,200);return {code,seed:s.data.data.secret,codes:result.data.data.recovery_codes};}
  async function approval(c,path,body,code,method='POST'){const r=await c.call('/api/account/step-up',{password,code,request:{method,path,body}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.approval;}
  return {accounts,admin,editor,viewer,owner,client,enroll,approval,queries,pool,messages,base};
}

test('TOTP vector, encrypted context binding, recovery one-use and replay protection',()=>{
  const crypt=platformCrypto(secret),seed='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(seed).generate({timestamp:59000}),'287082');
  const codes=recoveryCodes(crypt,1),row={enabled:true,secret_cipher:crypt.encrypt(seed,'mfa:1'),last_counter:-1,recovery:codes.hashes};
  assert.ok(!row.secret_cipher.includes(seed));assert.throws(()=>crypt.decrypt(row.secret_cipher,'mfa:2'));
  assert.equal(consumeMfa(row,'287082',crypt,1,59000),true);assert.equal(consumeMfa(row,'287082',crypt,1,59000),false);
  assert.equal(consumeMfa(row,codes.codes[0],crypt,1),true);assert.equal(consumeMfa(row,codes.codes[0],crypt,1),false);
});
test('bootstrap requires explicit assignments and does not promote other administrators',async()=>{
  const a=memoryAccountRepository('original',password);const id=await a.createUser({username:'Other',password_hash:await hashPassword(password),role:'admin',domains:[]});
  await assert.rejects(a.platformAtomic(d=>activatePlatform(d,{username:'Superadmin',passwordHash:'fixture-hash',assignments:{},domainKeys:['one']})));
  assert.equal((await a.platformStatus()).enabled,false);
  await a.platformAtomic(d=>activatePlatform(d,{username:'Superadmin',passwordHash:'fixture-hash',assignments:{1:['one'],[id]:[]},domainKeys:['one']}));
  assert.equal((await a.find('Superadmin')).role,'superadmin');assert.equal((await a.read(1)).role,'admin');assert.deepEqual(await a.permissions(id),[]);
  await assert.rejects(a.platformAtomic(d=>activatePlatform(d,{username:'Other'})));
});
test('Superadmin enrollment gates every protected route, persists encrypted factors and survives password reset',async t=>{
  const f=await fixture(t),pending=await f.owner.call('/api/auth/session');assert.equal(pending.data.mfa_enrollment_required,true);
  for(const path of ['/api/account','/api/domains','/api/users','/api/platform']){const r=await f.owner.call(path);assert.equal(r.status,403);assert.equal(r.data.code,'MFA_REQUIRED');}
  assert.equal((await f.owner.call('/api/notifications',{domain_key:'one',title:'x',body:'x'})).status,403);
  const {seed,code,codes}=await f.enroll();assert.equal(codes.length,10);
  assert.equal((await f.owner.call('/api/platform')).status,200);const stored=(await f.accounts.platformRead()).mfa[1];assert.ok(!JSON.stringify(stored).includes(seed));assert.ok(!JSON.stringify(stored).includes(codes[0]));
  const another=f.client();await another.login();assert.equal((await another.call('/api/platform')).status,403);
  assert.equal((await another.call('/api/auth/mfa/verify',{code})).status,400);
  assert.equal((await another.call('/api/auth/mfa/verify',{code:codes[0]})).status,200);
  assert.equal((await another.call('/api/account/mfa/disable',{password,code:codes[1]})).status,400);
  assert.equal((await another.call('/api/auth/mfa/verify',{code:codes[0]})).status,400);
  const profile=await f.accounts.read(1),raw=crypto.randomBytes(32).toString('base64url');
  await f.accounts.issueRecovery({user_id:1,session_version:profile.session_version,purpose:'verify',email:'fixture@example.test',token_hash:tokenHash(raw),expires_ms:Date.now()+600000});await f.accounts.redeemRecovery(tokenHash(raw),'verify');
  const reset=crypto.randomBytes(32).toString('base64url');await f.accounts.issueRecovery({user_id:1,session_version:profile.session_version,purpose:'reset',email:'fixture@example.test',token_hash:tokenHash(reset),expires_ms:Date.now()+600000});await f.accounts.redeemRecovery(tokenHash(reset),'reset',await hashPassword('Changed-fixture-password-123'));
  assert.equal((await f.accounts.platformStatus(1)).mfa_enabled,true);assert.equal((await another.call('/api/platform')).status,401);
});
test('Admin and team API scope cannot be widened by URL, role, grant, manager or session requests',async t=>{
  const f=await fixture(t),c=f.client();await c.login('Admin');
  const sites=await c.call('/api/domains');assert.deepEqual(sites.data.data.map(d=>d.domain_key),['one']);
  assert.equal((await c.call('/api/domains/two/integration')).status,403);assert.equal((await c.call('/api/domains/2',{},'DELETE')).status,403);assert.equal((await c.call('/api/domains',{})).status,403);assert.equal((await c.call('/api/platform')).status,403);
  const users=await c.call('/api/users');assert.deepEqual(users.data.data.map(u=>u.username).sort(),['Admin','Editor']);assert.ok(!JSON.stringify(users.data).includes('password_hash'));
  assert.equal((await c.call(`/api/users/${f.viewer}/sessions`)).status,404);
  for(const body of [{username:'Escalation',password,role:'superadmin',domains:[]},{username:'Escalation',password,role:'editor',domains:['two']},{username:'Escalation',password,role:'editor',domains:['one'],manager_id:1}]){
    // Admin-supplied manager_id is ignored: the server binds created members to the acting Admin.
    const receipt=await f.approval(c,'/api/users',body);
    const result=await c.call('/api/users',body,'POST',{'X-Notizo-Approval':receipt});
    if(body.manager_id){assert.equal(result.status,201);assert.equal((await f.accounts.platformRead()).teams[result.data.data.id],f.admin);}else assert.equal(result.status,403);
  }
  const activity=await c.call('/api/account/activity');assert.ok(activity.data.data.every(r=>r.actor_id===f.admin||r.actor_id===f.editor));
});
test('fresh approvals bind exact action, body, user and session, and cannot be replayed',async t=>{
  const f=await fixture(t),{codes}=await f.enroll(),path='/api/platform/pause',body={paused:true};
  assert.equal((await f.owner.call(path,body)).data.code,'STEP_UP_REQUIRED');
  const receipt=await f.approval(f.owner,path,body,codes[0]);
  assert.equal((await f.owner.call(path,{paused:false},'POST',{'X-Notizo-Approval':receipt})).status,403);
  assert.equal((await f.owner.call(path,body,'POST',{'X-Notizo-Approval':receipt})).status,200);
  assert.equal((await f.owner.call(path,body,'POST',{'X-Notizo-Approval':receipt})).status,403);
  const admin=f.client();await admin.login('Admin');assert.equal((await admin.call(path,body,'POST',{'X-Notizo-Approval':receipt})).status,403);
  const key=await senderKeyFor(f.accounts,secret,'one');
  const send=await fetch(f.base+'/api/notifications',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify({domain_key:'one',title:'Fixture',body:'Message',url:'/',audience:{platform:'all',subscribed:'all'}})});
  assert.equal(send.status,503);assert.equal(f.queries.some(q=>q.includes('FROM subscriptions')),false);
});
test('last enrolled active owner survives concurrent demotion requests',async t=>{
  const f=await fixture(t);await f.enroll();
  const id=await f.accounts.createUser({username:'Second',password_hash:await hashPassword(password),role:'superadmin',domains:[]});
  await f.accounts.platformAtomic(d=>{d.mfa[id]={enabled:true,last_counter:-1,recovery:[]};});
  const d=await f.accounts.platformRead();const auth=id=>({id,role:'superadmin',version:d.users[id].session_version});
  const results=await Promise.allSettled([[1,id],[id,1]].map(([actor,target])=>f.accounts.platformAtomic(current=>changeManagedUser(current,auth(actor),{role:'viewer',domains:[],is_active:true,version:d.users[target].access_version},target,null,['one','two']))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(Object.values((await f.accounts.platformRead()).users).filter(u=>u.role==='superadmin'&&u.is_active).length,1);
});
test('SMTP overrides are encrypted and sender key rotation preserves legacy credentials until explicit rotation',async t=>{
  const f=await fixture(t),mailer=managedMailer({accounts:f.accounts,secret,fallback:{enabled:false}}),crypt=platformCrypto(secret);
  const candidate=await mailer.candidate({enabled:false,host:'smtp.example.test',port:587,user:'mail@example.test',from:'mail@example.test',password:'private-fixture-password'});
  await f.accounts.platformAtomic(d=>{d.config.smtp=mailer.encrypt(candidate);});
  assert.ok(!JSON.stringify((await f.accounts.platformRead()).config).includes(candidate.password));assert.equal((await mailer.publicSettings()).password,undefined);assert.equal((await mailer.candidate({...candidate,password:''})).password,candidate.password);
  assert.equal((await mailer.settings()).password,candidate.password);assert.throws(()=>crypt.decrypt(mailer.encrypt(candidate),'bad-context'));
  const legacy=crypto.createHmac('sha256',secret).update('send:one').digest('base64url');assert.equal(await senderKeyFor(f.accounts,secret,'one'),legacy);
  await f.accounts.platformAtomic(d=>{d.config['sender:one']='1';});assert.notEqual(await senderKeyFor(f.accounts,secret,'one'),legacy);
});
test('deployment probes read without a human factor but cannot mutate or send',async t=>{
  const f=await fixture(t),user=await f.accounts.read(1),sid=crypto.randomUUID(),token=createAdminToken(secret,user.session_version,90000,{uid:1,sid});
  await f.accounts.startSession({id:sid,user_id:1,token_hash:tokenHash(token),login_ms:Date.now(),expires_ms:Date.now()+90000,source:'deployment'});
  for(const [path,method]of [['/api/domains','GET'],['/api/platform/pause','POST']]){const r=await fetch(f.base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(method==='POST'?{body:'{"paused":true}'}:{})});assert.equal(r.status,method==='GET'?200:403);}
  const send=await fetch(f.base+'/api/notifications',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{"domain_key":"one","title":"x","body":"x"}'});assert.equal(send.status,403);
});

test('Admin website removals revoke team grants and sessions; sensitive exports require owner policy and exact approval',async t=>{
  const f=await fixture(t),{codes}=await f.enroll(),adminUser=await f.accounts.read(f.admin);
  const edit={role:'admin',domains:[],is_active:true,version:adminUser.access_version};
  const receipt=await f.approval(f.owner,`/api/users/${f.admin}`,edit,codes[0],'PATCH');
  assert.equal((await f.owner.call(`/api/users/${f.admin}`,edit,'PATCH',{'X-Notizo-Approval':receipt})).status,200);
  assert.deepEqual(await f.accounts.permissions(f.editor),[]);
  assert.equal((await f.accounts.read(f.editor)).access_version,2);
  const path='/api/platform/exports/subscribers',body={domain_key:'one',reason:'Authorized backup fixture',include_location:false};
  const first=await f.approval(f.owner,path,body,codes[1]);assert.equal((await f.owner.call(path,body,'POST',{'X-Notizo-Approval':first})).status,403);
  await f.accounts.platformAtomic(d=>{d.state.policy.subscriber_exports=true;});
  const second=await f.approval(f.owner,path,body,codes[2]),csv=await f.owner.call(path,body,'POST',{'X-Notizo-Approval':second});assert.equal(csv.status,200);assert.match(csv.data,/public-encoded/);assert.match(csv.data,/"-auth-encoded"/);assert.ok(!csv.data.includes('vapid_private_key'));assert.ok(!csv.data.includes('ip_address'));
  const operations=Object.values((await f.accounts.platformRead()).operations);assert.ok(operations.some(o=>o.kind==='subscriber_export'&&o.details.reason===body.reason));
});
test('policy changes require Admin enrollment immediately and website pauses cannot override a global pause',async t=>{
  const f=await fixture(t),c=f.client();await c.login('Admin');
  const body={paused:true},path='/api/domains/one/sending-control',receipt=await f.approval(c,path,body,undefined,'PATCH');assert.equal((await c.call(path,body,'PATCH',{'X-Notizo-Approval':receipt})).status,200);
  assert.equal((await c.call('/api/domains/two/sending-control',{paused:false},'PATCH')).status,403);
  await f.accounts.platformAtomic(d=>{d.state.policy.require_admin_mfa=true;});
  const blocked=await c.call('/api/domains');assert.equal(blocked.status,403);assert.equal(blocked.data.code,'MFA_REQUIRED');assert.equal((await c.call('/api/auth/session')).data.mfa_enrollment_required,true);
});

test('unavailable SMTP settings fail safely without an unhandled recovery request rejection',async t=>{
  const f=await fixture(t);f.accounts.platformConfig=async()=>{throw new Error('Fixture encrypted settings unavailable');};
  assert.equal((await f.owner.call('/api/auth/forgot-password',{username:'Superadmin'})).status,503);
  assert.equal((await f.owner.call('/api/auth/session')).status,200);
});

test('non-owners cannot enumerate current or former Superadmin identities, sessions or history',async t=>{
  const f=await fixture(t);await f.enroll();const hiddenName='private-owner@example.test';
  const former=await f.accounts.createUser({username:hiddenName,password_hash:await hashPassword(password),role:'editor',domains:['one']});
  await f.accounts.platformAtomic(d=>{d.users[former].role='superadmin';});
  await f.accounts.platformAtomic(d=>{d.users[former].role='editor';d.teams[former]=f.admin;});
  const privateSession=crypto.randomUUID();await f.accounts.startSession({id:privateSession,user_id:former,token_hash:'fixture-hash',login_ms:Date.now(),expires_ms:Date.now()+60000,ip_address:'198.51.100.199'});
  for(let i=0;i<65;i++){
    await f.accounts.audit({actor_id:i%2?former:1,actor_name:i%2?hiddenName:'Superadmin',domain_key:'one',action:'/api/domains/one/settings',method:'PATCH'});
    await f.accounts.attempt({user_id:i%2?former:1,username:i%2?hiddenName:'Superadmin',succeeded:true,ip_address:'198.51.100.199'});
  }
  await f.accounts.audit({actor_id:f.admin,actor_name:'Admin',domain_key:null,action:`/api/users (${hiddenName})`,method:'POST'});
  await f.accounts.attempt({user_id:f.admin,username:'Admin',succeeded:true,ip_address:'203.0.113.3'});
  const c=f.client();await c.login('Admin');
  const users=await c.call('/api/users');assert.equal(users.status,200);assert.ok(!users.data.data.some(u=>[1,former].includes(u.id)));
  const history=await c.call('/api/account/activity');assert.equal(history.status,200);assert.ok(history.data.data.some(r=>r.action==='Account management'));
  const attempts=await c.call('/api/users/login-attempts');assert.equal(attempts.status,200);assert.ok(attempts.data.data.some(r=>r.username==='Admin'));
  for(const result of [users,history,attempts])for(const value of [hiddenName,'Superadmin','198.51.100.199'])assert.ok(!JSON.stringify(result.data).includes(value));
  for(const id of [1,former,99999]){const result=await c.call(`/api/users/${id}/sessions`);assert.equal(result.status,404);assert.equal(result.data.message,'User is unavailable.');}
  const ownerUsers=await f.owner.call('/api/users');assert.ok(ownerUsers.data.data.some(u=>u.id===former));assert.ok(ownerUsers.data.data.some(u=>u.id===1));
  const ownerHistory=await f.owner.call('/api/account/activity');assert.ok(ownerHistory.data.data.some(r=>r.actor_id===former));
  for(const username of ['Editor','Viewer']){const member=f.client();await member.login(username);assert.equal((await member.call('/api/users')).status,403);assert.equal((await member.call('/api/platform')).status,403);const own=await member.call('/api/account/activity');assert.equal(own.status,200);assert.ok(!JSON.stringify(own.data).includes(hiddenName));}
  // Even the compatibility routes used before role activation filter private identities.
  await f.accounts.platformAtomic(d=>{d.state.enabled=false;});
  const legacy=f.client();await legacy.login('Admin');
  await f.accounts.attempt({user_id:null,username:' '+hiddenName.toUpperCase()+' ',succeeded:false,ip_address:'198.51.100.199'});
  for(const path of ['/api/users','/api/users/login-attempts','/api/account/activity']){const result=await legacy.call(path);assert.equal(result.status,200);assert.ok(!JSON.stringify(result.data).toLowerCase().includes(hiddenName));assert.ok(!JSON.stringify(result.data).includes('198.51.100.199'));}
  assert.equal((await legacy.call(`/api/users/${former}/sessions`)).status,404);
});


test('owner-only account history captures creators and changes, paginates, and never exposes credentials',async t=>{
  const f=await fixture(t),{codes}=await f.enroll();
  for(const name of ['Admin','Editor','Viewer']){const c=f.client();await c.login(name);assert.equal((await c.call('/api/platform/account-history')).status,403);assert.equal((await c.call(`/api/platform/accounts/${f.editor}/reset-password`,{reason:'Authorized fixture reset'})).status,403);}
  const input={username:'Recorded-editor',password,role:'editor',domains:['one']},proof=await f.approval(f.owner,'/api/users',input,codes[0]);
  const made=await f.owner.call('/api/users',input,'POST',{'X-Notizo-Approval':proof});assert.equal(made.status,201);const id=made.data.data.id;
  let history=await f.owner.call('/api/platform/account-history');assert.equal(history.status,200);
  const entry=history.data.data.accounts.find(u=>u.id===id);assert.equal(entry.created.actor_name,'Superadmin');assert.ok(entry.created.time_ms);assert.equal(history.data.data.accounts.find(u=>u.id===f.viewer).created,null);
  const editor=f.client();await editor.login('Recorded-editor');assert.equal((await editor.call('/api/account/password',{current_password:password,new_password:'Replacement-fixture-password-123'})).status,200);
  history=await f.owner.call(`/api/platform/account-history?user_id=${id}`);assert.deepEqual(new Set(history.data.data.rows.map(e=>e.kind)),new Set(['account_created','password_changed']));assert.equal(history.data.data.accounts.find(u=>u.id===id).password.actor_name,'Recorded-editor');
  const text=JSON.stringify(history.data);for(const value of [password,'Replacement-fixture-password-123','password_hash','scrypt$','session_version'])assert.ok(!text.includes(value));
  assert.equal((await f.owner.call('/api/platform/account-history?offset=-1')).status,400);assert.equal((await f.owner.call('/api/platform/account-history?user_id=abc')).status,400);
  const {accountEvent,addAccountEvent}=await import('../account-events.js');await f.accounts.platformAtomic(d=>{for(let i=0;i<55;i++)addAccountEvent(d,accountEvent('account_access_changed',d.users[1],d.users[id]));});
  const first=await f.accounts.accountHistory({userId:id}),second=await f.accounts.accountHistory({userId:id,offset:50});assert.equal(first.rows.length,50);assert.equal(first.has_more,true);assert.equal(second.rows.length,7);assert.ok(!second.rows.some(e=>first.rows.some(a=>a.id===e.id)));
  assert.ok((await f.owner.call('/api/platform')).data.data.operations.every(e=>!e.kind.startsWith('account_')&&!e.kind.startsWith('password_')));
});

test('approved managed reset revokes old credentials immediately, preserves MFA, and the public form redeems it only once',async t=>{
  const f=await fixture(t),{codes}=await f.enroll(),admin=f.client();await admin.login('Admin');await f.enroll(admin);
  const old=structuredClone(await f.accounts.read(f.admin)),mfa=(await f.accounts.platformRead()).mfa[f.admin],body={reason:'Account holder requested recovery'},path=`/api/platform/accounts/${f.admin}/reset-password`;
  assert.equal((await f.owner.call(path,body)).data.code,'STEP_UP_REQUIRED');const proof=await f.approval(f.owner,path,body,codes[0]);
  const issued=await f.owner.call(path,body,'POST',{'X-Notizo-Approval':proof});assert.equal(issued.status,200);const token=new URLSearchParams(new URL(issued.data.data.reset_url).hash.slice(1)).get('reset');assert.equal(token.length,43);
  const changed=await f.accounts.read(f.admin);assert.notEqual(changed.session_version,old.session_version);assert.equal(await (await import('../accounts.js')).verifyPassword(password,changed.password_hash),false);assert.equal((await admin.call('/api/account')).status,401);
  const snapshot=await f.accounts.platformRead();assert.deepEqual(snapshot.mfa[f.admin],mfa);assert.deepEqual(snapshot.grants[f.admin],['one']);assert.ok(!JSON.stringify(snapshot).includes(token));
  const visitor=f.client();await visitor.call('/api/auth/session');const next='Reset-fixture-password-123';const results=await Promise.all([visitor.call('/api/auth/reset-password',{token,password:next}),visitor.call('/api/auth/reset-password',{token,password:next})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  const history=await f.accounts.accountHistory({userId:f.admin});assert.equal(history.rows.filter(e=>e.kind==='password_reset_requested').length,1);assert.equal(history.rows.filter(e=>e.kind==='password_reset_completed').length,1);assert.equal(history.rows.find(e=>e.kind==='password_reset_completed').requested_by.username,'Superadmin');assert.ok(!JSON.stringify(history).includes(token));
  await visitor.call('/api/auth/session');const login=await visitor.call('/api/login',{username:'Admin',password:next});assert.equal(login.status,200);assert.equal(login.data.mfa_required,true);
  assert.equal((await f.owner.call(path,body,'POST',{'X-Notizo-Approval':proof})).status,403);
  const selfPath='/api/platform/accounts/1/reset-password',selfProof=await f.approval(f.owner,selfPath,body,codes[1]);assert.equal((await f.owner.call(selfPath,body,'POST',{'X-Notizo-Approval':selfProof})).status,400);
});

test('managed reset rejects expired links, superseded versions and inactive targets',async t=>{
  const f=await fixture(t);await f.enroll();const u=await f.accounts.read(1),auth={id:1,role:'superadmin',version:u.session_version};
  const issue=async()=>{const raw=crypto.randomBytes(32).toString('base64url'),hash=tokenHash(raw);await f.accounts.startManagedReset(auth,f.editor,hash,'unusable-hash','Fixture approved reset');return hash;};
  const first=await issue();await f.accounts.platformAtomic(d=>{const key=`reset-link:${first}`,v=JSON.parse(d.config[key]);v.expires_ms=Date.now()-1;d.config[key]=JSON.stringify(v);});assert.equal(await f.accounts.redeemManagedReset(first,'replacement'),false);
  const second=await issue(),third=await issue();assert.equal(await f.accounts.redeemManagedReset(second,'replacement'),false);assert.ok(await f.accounts.redeemManagedReset(third,'replacement'));
  await f.accounts.platformAtomic(d=>{d.users[f.editor].is_active=false;});await assert.rejects(issue(),/active account/);
});


test('Superadmin edits credentials and websites atomically, revokes sessions, retains factors and records actor and prior username',async t=>{
  const f=await fixture(t),{codes}=await f.enroll(),admin=f.client();await admin.login('Admin');await f.enroll(admin);const factors=structuredClone((await f.accounts.platformRead()).mfa[f.admin]);
  const input={username:'RenamedAdmin',password:'New-admin-password-123',role:'admin',domains:['one','two'],is_active:true,version:(await f.accounts.read(f.admin)).access_version},path=`/api/users/${f.admin}`;
  assert.equal((await f.owner.call(path,input,'PATCH')).data.code,'STEP_UP_REQUIRED');const proof=await f.approval(f.owner,path,input,codes[0],'PATCH');assert.equal((await f.owner.call(path,input,'PATCH',{'X-Notizo-Approval':proof})).status,200);
  assert.equal(await f.accounts.find('Admin'),undefined);assert.equal((await f.accounts.find('RenamedAdmin')).id,f.admin);assert.deepEqual(await f.accounts.permissions(f.admin),['one','two']);assert.deepEqual((await f.accounts.platformRead()).mfa[f.admin],factors);assert.equal((await admin.call('/api/account')).status,401);
  const visitor=f.client();await visitor.call('/api/auth/session');assert.equal((await visitor.call('/api/login',{username:'RenamedAdmin',password})).status,401);assert.equal((await visitor.call('/api/login',{username:'RenamedAdmin',password:input.password})).status,200);
  const history=await f.accounts.accountHistory({userId:f.admin});assert.equal(history.rows.find(e=>e.kind==='password_changed').actor_name,'Superadmin');assert.equal(history.rows.find(e=>e.kind==='account_access_changed').changes.previous_username,'Admin');assert.ok(!JSON.stringify(history).includes(input.password));
  const stale=await f.approval(f.owner,path,input,codes[1],'PATCH');assert.equal((await f.owner.call(path,input,'PATCH',{'X-Notizo-Approval':stale})).status,409);
});

test('Admin edits only its own Editors and Viewers; passwords and resets stay scoped on the server',async t=>{
  const f=await fixture(t),admin=f.client(),editor=f.client();await admin.login('Admin');await editor.login('Editor');const path=`/api/users/${f.editor}`,body={username:'TeamEditor',password:'Edited-team-password-123',role:'editor',domains:['one'],is_active:true,version:(await f.accounts.read(f.editor)).access_version};
  let proof=await f.approval(admin,path,body,undefined,'PATCH');assert.equal((await admin.call(path,body,'PATCH',{'X-Notizo-Approval':proof})).status,200);assert.equal((await editor.call('/api/account')).status,401);
  const {verifyPassword}=await import('../accounts.js');assert.ok(await verifyPassword(body.password,(await f.accounts.read(f.editor)).password_hash));
  for(const id of [1,f.viewer]){const target=await f.accounts.read(id),input={username:'Forbidden',password:'Forbidden-password-123',role:target.role==='superadmin'?'viewer':target.role,domains:['one'],is_active:true,version:target.access_version},targetPath=`/api/users/${id}`;proof=await f.approval(admin,targetPath,input,undefined,'PATCH');assert.equal((await admin.call(targetPath,input,'PATCH',{'X-Notizo-Approval':proof})).status,404);}
  const before=await f.accounts.read(f.editor),oldHash=before.password_hash;
  const duplicate={...body,username:'Admin',password:undefined,version:before.access_version};delete duplicate.password;proof=await f.approval(admin,path,duplicate,undefined,'PATCH');assert.equal((await admin.call(path,duplicate,'PATCH',{'X-Notizo-Approval':proof})).status,409);assert.equal((await f.accounts.read(f.editor)).password_hash,oldHash);
  const resetPath=`/api/users/${f.editor}/reset-password`,reason={reason:'Verified member requested reset'};assert.equal((await admin.call(resetPath,reason)).data.code,'STEP_UP_REQUIRED');proof=await f.approval(admin,resetPath,reason);const reset=await admin.call(resetPath,reason,'POST',{'X-Notizo-Approval':proof});assert.equal(reset.status,200);assert.equal(await verifyPassword(body.password,(await f.accounts.read(f.editor)).password_hash),false);
  const raw=new URLSearchParams(new URL(reset.data.data.reset_url).hash.slice(1)).get('reset');assert.ok(await f.accounts.redeemManagedReset(tokenHash(raw),await hashPassword('Recovered-member-password-123')));assert.equal(await f.accounts.redeemManagedReset(tokenHash(raw),'ignored'),false);assert.equal((await f.accounts.accountHistory({userId:f.editor})).rows.find(e=>e.kind==='password_reset_requested').source,'team_reset');
  for(const id of [1,f.viewer,999]){const p=`/api/users/${id}/reset-password`,approval=await f.approval(admin,p,reason);assert.equal((await admin.call(p,reason,'POST',{'X-Notizo-Approval':approval})).status,404);}
});

test('Admin creates independent scoped Admins without acquiring edit/reset/session privileges over peers',async t=>{
  const f=await fixture(t),admin=f.client();await admin.login('Admin');const body={username:'NewAdmin',password,role:'admin',domains:['one']},proof=await f.approval(admin,'/api/users',body);
  const made=await admin.call('/api/users',body,'POST',{'X-Notizo-Approval':proof});assert.equal(made.status,201);const id=made.data.data.id,listed=(await admin.call('/api/users')).data.data.find(u=>u.id===id);assert.equal(listed.can_edit,false);assert.equal(listed.can_reset,false);assert.equal(listed.can_view_sessions,false);assert.ok(!JSON.stringify((await admin.call('/api/users')).data).includes('Superadmin'));
  const peer=f.client();assert.equal((await peer.login('NewAdmin')).status,200);assert.deepEqual((await peer.call('/api/domains')).data.data.map(d=>d.domain_key),['one']);assert.equal((await admin.call(`/api/users/${id}/sessions`)).status,404);
  const reason={reason:'Denied peer takeover request'},p=`/api/users/${id}/reset-password`,approval=await f.approval(admin,p,reason);assert.equal((await admin.call(p,reason,'POST',{'X-Notizo-Approval':approval})).status,404);
  const wide={...body,username:'TooWide',domains:['two']},wideProof=await f.approval(admin,'/api/users',wide);assert.equal((await admin.call('/api/users',wide,'POST',{'X-Notizo-Approval':wideProof})).status,403);assert.equal(await f.accounts.find('TooWide'),undefined);
  const edit={role:'editor',domains:['one'],is_active:true,version:listed.version},editPath=`/api/users/${id}`,editProof=await f.approval(admin,editPath,edit,undefined,'PATCH');assert.equal((await admin.call(editPath,edit,'PATCH',{'X-Notizo-Approval':editProof})).status,404);
});

test('renamed privileged accounts retain private aliases and anonymous old-name attempts stay hidden',async t=>{
  const f=await fixture(t),{codes}=await f.enroll(),id=await f.accounts.createUser({username:'PrivateOwner',password_hash:await hashPassword(password),role:'superadmin',domains:[]});
  await f.accounts.attempt({username:'PrivateOwner',user_id:null,succeeded:false});const body={username:'RenamedOwner',role:'superadmin',domains:[],is_active:true,version:(await f.accounts.read(id)).access_version},path=`/api/users/${id}`,proof=await f.approval(f.owner,path,body,codes[0],'PATCH');assert.equal((await f.owner.call(path,body,'PATCH',{'X-Notizo-Approval':proof})).status,200);
  assert.ok((await f.accounts.platformAttempts(null,0,{role:'admin'})).every(a=>!a.username.includes('PrivateOwner')));
  const admin=f.client();await admin.login('Admin');const creation={username:'PrivateOwner',password,role:'editor',domains:['one']},approval=await f.approval(admin,'/api/users',creation);assert.equal((await admin.call('/api/users',creation,'POST',{'X-Notizo-Approval':approval})).status,409);
});


test('every role owns an independently verified recovery address and cannot read or change another account address',async t=>{
  const f=await fixture(t);await f.enroll();const accounts=[['Superadmin',1,f.owner],['Admin',f.admin,f.client()],['Editor',f.editor,f.client()],['Viewer',f.viewer,f.client()]];
  assert.equal((await f.client().call('/api/account/recovery')).status,401);
  const verifier=f.client();await verifier.call('/api/auth/session');
  for(const [name,id,c]of accounts){
    if(name!=='Superadmin')await c.login(name);
    const email=name.toLowerCase()+'-recovery@example.test',other=id===1?f.admin:1;
    const wrong=await c.call('/api/account/recovery',{email,password:'incorrect'});assert.equal(wrong.status,400);
    const saved=await c.call('/api/account/recovery',{email,password,user_id:other});assert.equal(saved.status,200);
    const pending=(await c.call(`/api/account/recovery?user_id=${other}`)).data.data;assert.equal(pending.pending_email,email);assert.equal(pending.verified_email,undefined);
    assert.equal((await f.accounts.recovery(id)).pending_email,email);assert.notEqual((await f.accounts.recovery(other)).pending_email,email);
    const letter=f.messages.at(-1);assert.equal(letter.to,email);assert.equal(letter.purpose,'verify');const token=new URLSearchParams(new URL(letter.url).hash.slice(1)).get('verify');
    assert.equal((await verifier.call('/api/auth/verify-email',{token})).status,200);
    const own=(await c.call('/api/account/recovery')).data.data;assert.equal(own.verified_email,email);assert.equal(own.pending_email,null);assert.ok(!JSON.stringify(own).includes('token'));
  }
  for(const [name,id,c]of accounts){const own=(await c.call('/api/account/recovery?user_id=1')).data.data;assert.equal(own.verified_email,name.toLowerCase()+'-recovery@example.test');}
});
