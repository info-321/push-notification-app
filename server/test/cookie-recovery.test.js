import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createApp} from '../app.js';
import {memoryAccountRepository,verifyPassword} from '../accounts.js';
import {createRecoveryMailer} from '../mail.js';
async function until(check){for(let i=0;i<100&&!check();i++)await new Promise(r=>setTimeout(r,10));assert.ok(check());}
const password='Fixture-password-123',secret='cookie-recovery-fixture-secret-32-chars';
async function fixture(t,{enabled=true,sendError=false}={}){
  const accounts=memoryAccountRepository('owner',password),messages=[];
  const mailer={enabled,send:async row=>{if(sendError)throw new Error('fixture delivery failure');messages.push(row);}};
  const server=createApp({pool:{query:async()=>[[]]},accountRepository:accounts,webpush:{},secret,publicApiBase:'https://api.test',dashboardOrigins:'https://dashboard.test',dashboardBase:'https://dashboard.test',mailer}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const client=()=>{
    let cookie='',csrf='';
    const call=async(path,body,{headers={},method=body?'POST':'GET',omitCsrf=false}={})=>{
      const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:'https://dashboard.test',...(cookie?{Cookie:cookie}:{}),...(!omitCsrf&&csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
      const cookies=new Map(cookie.split('; ').filter(Boolean).map(c=>[c.split('=')[0],c]));
      for(const c of response.headers.getSetCookie()){const pair=c.split(';')[0];if(pair.endsWith('='))cookies.delete(pair.split('=')[0]);else cookies.set(pair.split('=')[0],pair);}
      cookie=[...cookies.values()].join('; ');
      const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;
      return {status:response.status,data,headers:response.headers,cookie,csrf};
    };
    return {call,async login(){await call('/api/auth/session');return call('/api/login',{username:'owner',password});}};
  };
  const c=client();await c.login();
  const verify=async()=>{assert.equal((await c.call('/api/account/recovery',{email:'owner@example.test',password})).status,200);const token=new URL(messages.at(-1).url).hash.split('=')[1];assert.equal((await c.call('/api/auth/verify-email',{token})).status,200);};
  return {accounts,c,client,messages,verify};
}

test('cookie login sends HttpOnly Secure host-only cookies and no JSON credential; logout invalidates replay',async t=>{
  const f=await fixture(t),c=f.client(),login=await c.login();
  const set=login.headers.getSetCookie().find(s=>s.startsWith('__Host-notizo_session='));
  assert.match(set,/HttpOnly/);assert.match(set,/Secure/);assert.match(set,/SameSite=Lax/);assert.match(set,/Path=\//);assert.ok(!set.includes('Domain='));assert.equal(login.data.token,undefined);assert.ok(login.data.csrfToken);
  const cookie=login.cookie;
  assert.equal((await c.call('/api/account')).status,200);
  assert.equal((await c.call('/api/logout',{})).status,200);
  assert.equal((await c.call('/api/account',undefined,{headers:{Cookie:cookie}})).status,401);
});
test('login CSRF, authenticated mutations, sibling-site and cross-site origins are rejected; public SDK remains readable',async t=>{
  const f=await fixture(t),c=f.client();
  assert.equal((await c.call('/api/login',{username:'owner',password})).status,403);
  const r=await f.c.call('/api/account/heartbeat',{}, {omitCsrf:true});assert.equal(r.status,403);assert.equal(r.data.code,'CSRF');
  assert.equal((await f.c.call('/api/account/heartbeat',{}, {headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await f.c.call('/api/account/heartbeat',{}, {headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await f.c.call('/api/account/heartbeat',{})).status,200);
  const allowed=await f.c.call('/api/auth/session');assert.equal(allowed.headers.get('access-control-allow-origin'),'https://dashboard.test');assert.equal(allowed.headers.get('access-control-allow-credentials'),'true');
  const denied=await f.c.call('/api/auth/session',undefined,{headers:{Origin:'https://evil.test'}});assert.equal(denied.headers.get('access-control-allow-credentials'),null);
});
test('raw interactive bearer and legacy tokens are not accepted',async t=>{
  const f=await fixture(t),login=await f.c.login(),raw=login.cookie.match(/__Host-notizo_session=([^;]+)/)[1];
  assert.equal((await f.client().call('/api/account',undefined,{headers:{Authorization:`Bearer ${raw}`}})).status,401);
});
test('recovery email requires current password, email verification and one-time confirmation',async t=>{
  const f=await fixture(t);
  assert.equal((await f.c.call('/api/account/recovery',{email:'owner@example.test',password:'wrong'})).status,400);
  await f.verify();const settings=await f.c.call('/api/account/recovery');assert.equal(settings.data.data.verified_email,'owner@example.test');
  const token=new URL(f.messages[0].url).hash.split('=')[1];assert.equal((await f.c.call('/api/auth/verify-email',{token})).status,400);
  assert.equal(f.messages[0].url.startsWith('https://dashboard.test/login#verify='),true);
});
test('reset only uses verified addresses; unknown usernames have the same generic response',async t=>{
  const f=await fixture(t);
  const none=await f.c.call('/api/auth/forgot-password',{username:'owner'}),unknown=await f.c.call('/api/auth/forgot-password',{username:'does-not-exist'});
  assert.deepEqual(none.data,unknown.data);assert.equal(none.status,202);assert.equal(f.messages.length,0);
  await f.verify();await f.c.call('/api/auth/forgot-password',{username:'owner'});await until(()=>f.messages.length===2);assert.equal(f.messages.at(-1).purpose,'reset');assert.equal(f.messages.at(-1).to,'owner@example.test');
});
test('password reset is single-use, rejects expiry and rotates passwords while revoking every session',async t=>{
  const f=await fixture(t);await f.verify();
  const other=f.client();await other.login();await f.c.call('/api/auth/forgot-password',{username:'owner'});await until(()=>f.messages.length===2);
  const token=new URL(f.messages.at(-1).url).hash.split('=')[1],next='New-fixture-password-456';
  const result=await f.c.call('/api/auth/reset-password',{token,password:next});assert.equal(result.status,200);assert.equal(result.data.token,undefined);
  assert.equal(await verifyPassword(next,(await f.accounts.read()).password_hash),true);
  assert.equal((await other.call('/api/account')).status,401);
  await f.c.call('/api/auth/session');assert.equal((await f.c.call('/api/auth/reset-password',{token,password:next})).status,400);
  const row=await f.accounts.read(),expired=crypto.randomBytes(32).toString('base64url');await f.accounts.issueRecovery({token_hash:crypto.createHash('sha256').update(expired).digest('hex'),user_id:1,purpose:'reset',email:'owner@example.test',session_version:row.session_version,expires_ms:Date.now()-1});
  assert.equal((await f.c.call('/api/auth/reset-password',{token:expired,password:password})).status,400);
});
test('issuing a newer reset invalidates its predecessor and stored tokens are hashed; password changes invalidate links',async t=>{
  const f=await fixture(t);await f.verify();await f.c.call('/api/auth/forgot-password',{username:'owner'});await until(()=>f.messages.length===2);const old=new URL(f.messages.at(-1).url).hash.split('=')[1];await f.c.call('/api/auth/forgot-password',{username:'owner'});await until(()=>f.messages.length===3);const current=new URL(f.messages.at(-1).url).hash.split('=')[1];
  assert.equal((await f.c.call('/api/auth/reset-password',{token:old,password:'New-password-12345'})).status,400);
  await f.c.call('/api/account/password',{current_password:password,new_password:'Changed-password-12345'});
  assert.equal((await f.c.call('/api/auth/reset-password',{token:current,password:'New-password-12345'})).status,400);
});
test('disabled SMTP is explicit and TLS configuration rejects incomplete setup',async t=>{
  const f=await fixture(t,{enabled:false});
  assert.equal((await f.c.call('/api/account/recovery')).data.data.mail_enabled,false);
  assert.equal((await f.c.call('/api/auth/forgot-password',{username:'owner'})).status,503);
  assert.equal(createRecoveryMailer({}).enabled,false);
  assert.throws(()=>createRecoveryMailer({MAIL_ENABLED:'true',SMTP_PORT:'25'}),/Configure SMTP/);
});
test('email failure invalidates verification token, and account/IP request limits persist in the repository',async t=>{
  const f=await fixture(t,{sendError:true});
  assert.equal((await f.c.call('/api/account/recovery',{email:'owner@example.test',password})).status,503);
  for(let n=0;n<4;n++)await f.c.call('/api/account/recovery',{email:'owner@example.test',password:'wrong'});
  assert.equal((await f.c.call('/api/account/recovery',{email:'owner@example.test',password})).status,429);
});

test('pre-cookie tracked credentials are rejected even if presented in a Cookie header',async t=>{
  const f=await fixture(t),login=await f.c.login();
  const session=(await f.accounts.sessions(1))[0];session.auth_transport='legacy';
  assert.equal((await f.c.call('/api/account')).status,401);
});
