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
