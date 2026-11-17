import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.js';
import {memoryAccountRepository,createAdminToken} from '../accounts.js';
import {validDraft} from '../drafts.js';
const password='Fixture-password-123',secret='isolated-dashboard-security-fixture-secret';
const content={draft:{title:'Unfinished article',body:'Draft message',url:'/',icon:'',banner:{enabled:false,image:'',actions:[]}},selected:['one'],platform:'all',subscribed:'all',targetDevices:'all',targetBrowsers:'all',webEnabled:true,sendMode:'now',schedule:{kind:'once',time_zone:'UTC',start:''},step:2};
async function fixture(t){
  const accounts=memoryAccountRepository('owner',password),drafts=new Map();
  const domains=[{id:1,domain_key:'one',domain_name:'one.test',user_id:1,time_zone:'UTC'},{id:2,domain_key:'two',domain_name:'two.test',user_id:1}];
  const pool={query:async(sql,p=[])=>{
    if(sql.startsWith('SELECT')&&sql.includes('FROM notification_drafts')){const row=drafts.get(`${p[0]}:${p[1]}`);return [row?[row]:[]];}
    if(sql.startsWith('INSERT INTO notification_drafts')){const key=`${p[0]}:${p[1]}`;if(drafts.has(key))throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'});drafts.set(key,{version:1,content:JSON.parse(p[2]),updated_ms:p[3]});return [{}];}
    if(sql.startsWith('UPDATE notification_drafts')){const row=drafts.get(`${p[2]}:${p[3]}`);if(!row||row.version!==p[4])return [{affectedRows:0}];Object.assign(row,{version:row.version+1,content:JSON.parse(p[0]),updated_ms:p[1]});return [{affectedRows:1}];}
    if(sql.startsWith('DELETE FROM notification_drafts')){const key=`${p[0]}:${p[1]}`,row=drafts.get(key);if(!row||row.version!==p[2])return [{affectedRows:0}];drafts.delete(key);return [{affectedRows:1}];}
    if(sql.startsWith('SELECT')&&sql.includes('FROM notification_schedules'))return [[{domain_key:'two'}]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM domains')){if(sql.includes('WHERE id=?'))return [domains.filter(d=>d.id===p[0])];if(sql.includes('domain_key = ?')||sql.includes('domain_key=?'))return [domains.filter(d=>d.domain_key===p[0])];return [domains];}
    if(sql.startsWith('UPDATE domains SET time_zone'))return [{affectedRows:1}];
    throw new Error('Unexpected query: '+sql);
  }};
  const app=createApp({pool,accountRepository:accounts,webpush:{sendNotification:()=>{throw new Error('No actual sending in security tests');}},secret,publicApiBase:'https://api.test'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  const call=async(path,method='GET',body,token,headers={})=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',...headers,...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
  const login=async(username='owner',pass=password)=>call('/api/login','POST',{username,password:pass},null,{'X-Forwarded-For':'104.16.0.1','CF-Connecting-IP':'203.0.113.77'});
  const root=(await login()).token;
  const create=async(username,role='editor',sites=['one'])=>{const r=await call('/api/users','POST',{username,password,role,domains:sites},root);assert.equal(r.status,201);return {id:r.data.id,token:(await login(username)).token};};
  return {accounts,call,login,root,create,drafts};
}
test('users have individual salted credentials; editors and viewers cannot bypass domain/role access through IDs, schedules or sends',async t=>{
  const f=await fixture(t);assert.equal((await f.call('/api/users')).status,401);
  const editor=await f.create('editor'),viewer=await f.create('viewer','viewer');
  for(const user of [editor,viewer]){
    assert.deepEqual((await f.call('/api/domains','GET',null,user.token)).data.map(d=>d.domain_key),['one']);
    assert.equal((await f.call('/api/domains/two','GET',null,user.token)).status,403);
    assert.equal((await f.call('/api/domains/2','PATCH',{name:'Hijack'},user.token)).status,403);
    assert.equal((await f.call('/api/schedules/job/runs','GET',null,user.token)).status,403);
    assert.equal((await f.call('/api/schedules','POST',{domain_key:'two'},user.token)).status,403);
    assert.equal((await f.call('/api/notifications/compose','POST',{domain_key:'two',title:'Forbidden'},user.token)).status,403);
    assert.equal((await f.call('/api/users','GET',null,user.token)).status,403);
    assert.equal((await f.call('/api/domains','POST',{name:'Forbidden',domain:'new.test'},user.token)).status,403);
  }
  assert.equal((await f.call('/api/domains/one/settings','PUT',{time_zone:'UTC'},editor.token)).status,200);
  assert.equal((await f.call('/api/domains/one/integration','GET',null,editor.token)).data.sender_api_key,null,'Editors must not obtain independent service credentials that bypass session revocation');
  assert.equal((await f.call('/api/domains/one/settings','PUT',{time_zone:'UTC'},viewer.token)).status,403);
  assert.equal((await f.call('/api/domains/one/integration','GET',null,viewer.token)).status,403);
  assert.equal((await f.call('/api/notifications','POST',{domain_key:'one',title:'Forbidden'},viewer.token)).status,403);
  assert.equal((await f.call('/api/users/1','PATCH',{role:'viewer',domains:[],is_active:false,version:1},f.root)).status,400);
  const users=(await f.call('/api/users','GET',null,f.root)).data;
  assert.equal(users.length,3);assert.equal(JSON.stringify(users).includes('password_hash'),false);
  assert.notEqual((await f.accounts.read(editor.id)).password_hash,(await f.accounts.read(viewer.id)).password_hash);
  const changed=await f.call(`/api/users/${editor.id}`,'PATCH',{role:'editor',domains:['two'],is_active:true,version:1},f.root);assert.equal(changed.status,200);
  assert.equal((await f.call('/api/account','GET',null,editor.token)).status,401);
  const fresh=(await f.login('editor')).token;
  assert.deepEqual((await f.call('/api/domains','GET',null,fresh)).data.map(d=>d.domain_key),['two']);
  assert.equal((await f.call(`/api/users/${editor.id}`,'PATCH',{role:'viewer',domains:[],is_active:false,version:1},f.root)).status,409);
});
test('sessions record real proxy IP/device, support logout/revocation/expiry and expose no raw token hashes',async t=>{
  const f=await fixture(t),one=await f.create('editor'),second=await f.login('editor');
  const rows=(await f.call('/api/account/sessions','GET',null,second.token)).data;
  assert.equal(rows.length,2);assert.equal(rows[0].ip_address,'203.0.113.77');assert.equal(rows[0].os,'Windows');assert.equal(rows[0].browser,'Chrome');assert.equal(rows[0].device,'desktop');
  assert.equal(JSON.stringify(rows).includes('token_hash'),false);assert.equal(rows[0].current,true);
  const rootSid=(await f.call('/api/account/sessions','GET',null,f.root)).data[0].id;
  assert.equal((await f.call(`/api/account/sessions/${rootSid}`,'DELETE',null,second.token)).status,404);
  assert.equal((await f.call(`/api/account/sessions/${rows[1].id}`,'DELETE',null,second.token)).status,200);
  assert.equal((await f.call('/api/account','GET',null,one.token)).status,401);
  assert.equal((await f.call('/api/logout','POST',null,second.token)).status,200);
  assert.equal((await f.call('/api/account','GET',null,second.token)).status,401);
  const saved=await f.accounts.sessions(one.id);assert.ok(saved.every(s=>s.ended_ms));assert.ok(saved.some(s=>s.end_reason==='logout'));assert.ok(saved.some(s=>s.end_reason==='revoked'));
  const third=await f.login('editor'),sid=JSON.parse(Buffer.from(third.token.split('.')[0],'base64url')).sid;(await f.accounts.session(sid)).expires_ms=Date.now()-1;
  assert.equal((await f.call('/api/account','GET',null,third.token)).status,401);
});
test('failed logins and action outcomes persist without passwords; old untracked tokens stop working after migration grace',async t=>{
  const f=await fixture(t);await f.login('owner','incorrect-password');
  const attempts=(await f.call('/api/users/login-attempts','GET',null,f.root)).data;
  assert.ok(attempts.some(a=>!a.succeeded));assert.equal(JSON.stringify(attempts).includes('incorrect-password'),false);
  await f.call('/api/domains/one/settings','PUT',{time_zone:'UTC'},f.root);
  await new Promise(resolve=>setTimeout(resolve,10));
  const events=(await f.call('/api/account/activity','GET',null,f.root)).data;
  assert.ok(events.some(e=>e.domain_key==='one'&&e.http_status===200));assert.equal(JSON.stringify(events).includes(f.root),false);
  const row=await f.accounts.read(),legacy=createAdminToken(secret,row.session_version,1000);
  assert.equal((await f.call('/api/account','GET',null,legacy)).status,200);
  const read=f.accounts.read.bind(f.accounts);f.accounts.read=async id=>({...await read(id),legacy_deadline_ms:0});
  assert.equal((await f.call('/api/account','GET',null,legacy)).status,401);
  assert.equal((await f.call('/api/account','GET',null,f.root)).status,200);
});
test('drafts persist incomplete content per user/domain; stale tabs and cross-domain payloads cannot overwrite saved work',async t=>{
  const f=await fixture(t),editor=await f.create('editor'),other=await f.create('other');
  assert.equal(validDraft(content),true);assert.equal(validDraft({...content,password:'should-not-be-accepted'}),false);
  const path='/api/domains/one/draft';
  assert.equal((await f.call(path)).status,401);
  assert.equal((await f.call(path,'PUT',{version:0,content},editor.token)).status,200);
  assert.equal((await f.call(path,'GET',null,other.token)).data,null);
  assert.equal((await f.call('/api/domains/two/draft','PUT',{version:0,content},editor.token)).status,403);
  assert.equal((await f.call(path,'PUT',{version:1,content:{...content,selected:['two']}},editor.token)).status,403);
  const next={...content,draft:{...content.draft,title:'Changed'}};
  assert.equal((await f.call(path,'PUT',{version:1,content:next},editor.token)).status,200);
  assert.equal((await f.call(path,'PUT',{version:1,content},editor.token)).status,409);
  assert.equal((await f.call(path,'DELETE',null,editor.token)).status,400);
  assert.equal((await f.call(path+'?version=1','DELETE',null,editor.token)).status,409);
  const saved=(await f.call(path,'GET',null,editor.token)).data;assert.equal(saved.version,2);assert.equal(saved.content.draft.title,'Changed');
  assert.equal((await f.call(path+'?version=2','DELETE',null,editor.token)).status,200);
});

test('logging out an old untracked token closes its migration grace without inventing a password change',async t=>{
  const f=await fixture(t),row=await f.accounts.read(),legacy=createAdminToken(secret,row.session_version,1000);
  assert.equal((await f.call('/api/logout','POST',null,legacy)).status,200);
  assert.equal((await f.accounts.read()).password_changed_at,null);
  assert.equal((await f.call('/api/account','GET',null,legacy)).status,401);
  assert.equal((await f.call('/api/account','GET',null,f.root)).status,401);
  assert.equal((await f.login()).status,200);
});
