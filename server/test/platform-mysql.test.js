import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {mysqlAccountRepository,hashPassword} from '../accounts.js';
import {activatePlatform} from '../platform-bootstrap.js';
import {platformCrypto,newMfa,consumeMfa,recoveryCodes} from '../platform-crypto.js';
import {changeManagedUser} from '../platform-users.js';
import {platformSendingPaused} from '../platform-services.js';

test('MySQL platform migration, durable encrypted secrets, single-use factors and concurrent owner protection',{skip:process.env.SCHEDULE_TEST_MYSQL!=='1'},async()=>{
  const root=await mysql.createConnection({host:'127.0.0.1',port:33309,user:'root',password:'disposable-scheduler-ci'});
  const name='platform_test_'+crypto.randomBytes(5).toString('hex');assert.match(name,/^platform_test_[a-f0-9]{10}$/);
  await root.query(`CREATE DATABASE ${name}`);
  const pool=mysql.createPool({host:'127.0.0.1',port:33309,user:'root',password:'disposable-scheduler-ci',database:name,multipleStatements:true,connectionLimit:5});
  try{
    await pool.query(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
    const accounts=mysqlAccountRepository(pool);await accounts.initialize('Original','Fixture-password-123');
    await pool.query("INSERT INTO domains (user_id,domain_name,domain_key,verification_token,vapid_public_key,vapid_private_key) VALUES (1,'fixture.test','one','verify','fixture-public','fixture-private')");
    await pool.query("INSERT INTO subscriptions (user_id,domain_key,endpoint,p256dh,auth) VALUES (1,'one','https://fcm.googleapis.com/fcm/send/fixture','fixture-p256dh','fixture-auth')");
    const before=(await pool.query('SELECT * FROM domains'))[0],subscriptions=(await pool.query('SELECT * FROM subscriptions'))[0];
    await accounts.platformAtomic(d=>activatePlatform(d,{username:'Superadmin',passwordHash:'fixture-owner-hash',assignments:{1:['one']},domainKeys:['one']}));
    const owner=await accounts.find('Superadmin'),crypt=platformCrypto('test-encryption-key'),codes=recoveryCodes(crypt,owner.id),seed=newMfa();
    await accounts.platformAtomic(d=>{d.mfa[owner.id]={user_id:owner.id,enabled:true,secret_cipher:crypt.encrypt(seed,`mfa:${owner.id}`),last_counter:-1,recovery:codes.hashes};d.config.smtp=crypt.encrypt({password:'fixture-mail-password'},'platform:smtp');});
    const restarted=mysqlAccountRepository(pool);await restarted.initialize('Ignored','Ignored');
    assert.equal((await restarted.platformStatus(owner.id)).enabled,true);assert.equal((await restarted.platformStatus(owner.id)).mfa_enabled,true);assert.deepEqual(await restarted.permissions(1),['one']);
    const stored=(await pool.query('SELECT * FROM platform_mfa WHERE user_id=?',[owner.id]))[0][0];assert.ok(!JSON.stringify(stored).includes(seed));assert.ok(!JSON.stringify(stored).includes(codes.codes[0]));
    const attempts=await Promise.all([accounts,restarted].map(a=>a.platformAtomic(d=>consumeMfa(d.mfa[owner.id],codes.codes[0],crypt,owner.id))));assert.equal(attempts.filter(Boolean).length,1);
    const second=await accounts.createUser({username:'Second',password_hash:await hashPassword('Other-fixture-password-123'),role:'superadmin',domains:[]});await accounts.platformAtomic(d=>{d.mfa[second]={user_id:second,enabled:true,last_counter:-1,recovery:[]};});
    const data=await accounts.platformRead(),auth=id=>({id,role:'superadmin',version:data.users[id].session_version});
    const results=await Promise.allSettled([[owner.id,second],[second,owner.id]].map(([actor,target])=>accounts.platformAtomic(d=>changeManagedUser(d,auth(actor),{role:'viewer',domains:[],is_active:true,version:data.users[target].access_version},target,null,['one']))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(Object.values((await accounts.platformRead()).users).filter(u=>u.role==='superadmin'&&u.is_active).length,1);
    // Visibility is applied in SQL before pagination and survives role changes/restart.
    const ordinary={id:1,role:'admin'},ownerAuth={id:Object.values((await accounts.platformRead()).users).find(u=>u.role==='superadmin').id,role:'superadmin'};
    const privateIds=[owner.id,second];
    for(let i=0;i<3;i++){
      await accounts.attempt({username:'Original',user_id:1,succeeded:true,ip_address:'203.0.113.5',device:null,browser:null,os:null});
      await accounts.audit({actor_id:1,actor_name:'Original',domain_key:'one',action:'/api/domains/one/settings',method:'PATCH'});
    }
    for(let i=0;i<60;i++){
      const user=await accounts.read(privateIds[i%2]);
      await accounts.attempt({username:user.username,user_id:user.id,succeeded:true,ip_address:'198.51.100.199',device:null,browser:null,os:null});
      await accounts.audit({actor_id:user.id,actor_name:user.username,domain_key:'one',action:'/api/domains/one/settings',method:'PATCH'});
    }
    await accounts.attempt({username:' '+owner.username.toUpperCase()+' ',user_id:null,succeeded:false,ip_address:'198.51.100.199',device:null,browser:null,os:null});
    const again=mysqlAccountRepository(pool);await again.initialize('Ignored','Ignored');
    const visibleAttempts=await again.platformAttempts([1,...privateIds],0,ordinary),visibleActivity=await again.platformActivity(ordinary);
    assert.equal(visibleAttempts.length,3);assert.ok(visibleAttempts.every(r=>r.user_id===1));
    assert.equal(visibleActivity.length,3);assert.ok(visibleActivity.every(r=>r.actor_id===1));
    assert.equal((await again.platformAttempts(null,0,ordinary)).length,3);
    assert.equal((await again.platformAttempts(null,0,ownerAuth)).length,50);assert.equal((await again.platformActivity(ownerAuth)).length,50);
    assert.equal((await again.platformAttempts([1,...privateIds],50,ordinary)).length,0);
    await accounts.platformAtomic(d=>{d.state.sends_paused=true;});assert.equal(await platformSendingPaused(pool),true);
    assert.deepEqual((await pool.query('SELECT * FROM domains'))[0],before);assert.deepEqual((await pool.query('SELECT * FROM subscriptions'))[0],subscriptions);
    assert.equal(crypt.decrypt(await accounts.platformConfig('smtp'),'platform:smtp').password,'fixture-mail-password');
    const id=crypto.randomUUID();await accounts.platformAtomic(d=>{d.operations[id]={id,kind:'backup',status:'completed',actor_id:0,created_ms:Date.now(),details:{snapshot:'fixture-safe-name'}};});assert.equal((await restarted.platformRead()).operations[id].details.snapshot,'fixture-safe-name');
    // Lifecycle history uses the existing operations/config tables and survives restarts.
    let history=await restarted.accountHistory();assert.equal(history.accounts.find(u=>u.id===1).created.actor_name,'Host operator');
    const activeOwner=Object.values((await accounts.platformRead()).users).find(u=>u.role==='superadmin'&&u.is_active),actor={id:activeOwner.id,role:'superadmin',version:activeOwner.session_version};
    const target=structuredClone(await accounts.read(1)),token=crypto.randomBytes(32).toString('base64url'),digest=crypto.createHash('sha256').update(token).digest('hex');
    await accounts.startSession({id:crypto.randomUUID(),user_id:1,token_hash:'a'.repeat(64),login_ms:Date.now(),expires_ms:Date.now()+600000,auth_transport:'cookie',ip_address:null,device:null,browser:null,os:null});
    await accounts.startManagedReset(actor,1,digest,'unusable-test-hash','Verified holder requested reset');
    assert.notEqual((await restarted.read(1)).session_version,target.session_version);assert.ok((await restarted.read(1)).password_changed_at);
    assert.equal((await accounts.sessions(1))[0].end_reason,'password_reset');assert.ok(!JSON.stringify(await accounts.platformRead()).includes(token));
    const resets=await Promise.all([accounts,restarted].map(a=>a.redeemManagedReset(digest,'new-fixture-hash')));assert.equal(resets.filter(Boolean).length,1);
    history=await restarted.accountHistory({userId:1});assert.equal(history.rows.filter(e=>e.kind==='password_reset_completed').length,1);assert.equal(history.rows.find(e=>e.kind==='password_reset_requested').actor_name,activeOwner.username);assert.equal(history.accounts.find(u=>u.id===1).password.source,'owner_reset_link');
    // Audit failure must roll back both the password and reset-token changes.
    await pool.query("CREATE TRIGGER reject_fixture_event BEFORE INSERT ON platform_operations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'");
    const unchanged=await accounts.read(1);await assert.rejects(accounts.startManagedReset(actor,1,'b'.repeat(64),'bad-hash','Rollback fixture request'));
    assert.deepEqual(await accounts.read(1),unchanged);assert.equal(await accounts.platformConfig('reset-link:'+'b'.repeat(64)),null);
    await assert.rejects(accounts.changePassword(unchanged.password_hash,'bad-hash','bad-version',new Date(),1));assert.deepEqual(await accounts.read(1),unchanged);
    await pool.query('DROP TRIGGER reject_fixture_event');
    const {accountEvent,addAccountEvent}=await import('../account-events.js');await accounts.platformAtomic(d=>{for(let i=0;i<55;i++)addAccountEvent(d,accountEvent('account_access_changed',d.users[activeOwner.id],d.users[1]));});
    const firstPage=await restarted.accountHistory({userId:1}),secondPage=await restarted.accountHistory({userId:1,offset:50});assert.equal(firstPage.rows.length,50);assert.equal(firstPage.has_more,true);assert.ok(secondPage.rows.length>0);assert.ok(!secondPage.rows.some(e=>firstPage.rows.some(a=>a.id===e.id)));assert.ok((await restarted.platformRead()).operations[id]);
    // A username, credential and website update survives repository restart together.
    const oldUser=await accounts.read(1),nextHash=await hashPassword('Managed-SQL-password-123');
    await accounts.platformAtomic(d=>changeManagedUser(d,actor,{username:'OriginalRenamed',role:'admin',domains:['one'],is_active:true,version:oldUser.access_version},1,nextHash,['one']));
    assert.equal(await restarted.find('Original'),undefined);assert.equal((await restarted.find('OriginalRenamed')).id,1);assert.equal((await restarted.read(1)).password_hash,nextHash);assert.deepEqual(await restarted.permissions(1),['one']);
    const renamedHistory=await restarted.accountHistory({userId:1});assert.ok(renamedHistory.rows.some(e=>e.kind==='account_access_changed'&&e.changes?.previous_username==='Original'));assert.ok(renamedHistory.rows.some(e=>e.kind==='password_changed'&&e.source==='user_management'));
    const adminState=await accounts.read(1),adminAuth={id:1,role:'admin',version:adminState.session_version};
    const peer=await accounts.platformAtomic(d=>changeManagedUser(d,adminAuth,{username:'DelegatedAdmin',role:'admin',domains:['one']},null,nextHash,['one']));
    assert.equal((await restarted.read(peer)).role,'admin');assert.equal(await restarted.platformConfig(`admin-created-by:${peer}`),'1');
    const current=await accounts.read(1),beforeDuplicate=structuredClone(current);await assert.rejects(accounts.platformAtomic(d=>changeManagedUser(d,actor,{username:'DelegatedAdmin',role:'admin',domains:['one'],is_active:true,version:current.access_version},1,'bad-hash',['one'])));assert.deepEqual(await restarted.read(1),beforeDuplicate);
    const legacyTarget=await accounts.createUser({username:'LegacyTarget',password_hash:nextHash,role:'editor',domains:['one']});
    assert.equal(await accounts.updateUser(legacyTarget,{username:'LegacyRenamed',password_hash:nextHash,role:'editor',domains:['one'],is_active:true,version:1},actor),true);assert.equal((await restarted.find('LegacyRenamed')).id,legacyTarget);assert.ok((await restarted.accountHistory({userId:legacyTarget})).rows.some(e=>e.kind==='password_changed'));
  }finally{await pool.end();await root.query(`DROP DATABASE ${name}`);await root.end();}
});
