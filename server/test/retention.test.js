import test from 'node:test';
import assert from 'node:assert/strict';
import {retentionPolicy,runRetention} from '../retention.js';

test('retention rejects unsafe ages, unknown fields and unbounded batches',()=>{
  assert.equal(retentionPolicy().days,90);
  for(const input of [{days:0},{days:89},{days:'90'},{auditDays:90},{batch:1001},{maxBatches:101},{unknown:true}])assert.throws(()=>retentionPolicy(input));
  assert.equal(retentionPolicy({days:180}).days,180);
});

test('retention preview only reads counts and releases its connection and exclusion lock',async()=>{
  const sql=[];let released=false;
  const c={query:async(query)=>{sql.push(query);return [[query.includes('GET_LOCK')?{acquired:1}:{n:4}]];},release:()=>{released=true;}};
  const result=await runRetention({getConnection:async()=>c},{now:1794900000000});
  assert.equal(result.mode,'preview');assert.equal(result.eligible.login_attempts,4);assert.deepEqual(result.changed,{});
  assert.ok(sql.every(q=>q.startsWith('SELECT')));assert.ok(sql.at(-1).includes('RELEASE_LOCK'));assert.equal(released,true);
});

test('a competing retention run cannot perform any cleanup',async()=>{
  const sql=[];let released=false;
  const c={query:async q=>{sql.push(q);return [[{acquired:0}]];},release:()=>{released=true;}};
  await assert.rejects(runRetention({getConnection:async()=>c},{apply:true}),/Another retention/);
  assert.equal(sql.length,1);assert.equal(released,true);
});

test('bounded cleanup clears old details without deleting accounts, drafts, subscribers or lifecycle history',async()=>{
  const sql=[];let released=false;
  const c={query:async q=>{sql.push(q);if(q.includes('GET_LOCK'))return [[{acquired:1}]];if(q.startsWith('SELECT COUNT'))return [[{n:5}]];if(q.startsWith('SELECT'))return [[]];return [{affectedRows:1}];},
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{released=true;}};
  const result=await runRetention({getConnection:async()=>c},{apply:true,policy:{batch:1,maxBatches:2}});
  assert.equal(result.changed.login_attempts,2);assert.equal(released,true);
  assert.ok(sql.some(q=>q.startsWith('UPDATE subscriptions SET ip_address=NULL')));
  assert.ok(!sql.some(q=>/^DELETE FROM (subscriptions|domains|admin_accounts|notification_drafts|subscription_events)\b/.test(q)));
  assert.ok(sql.filter(q=>q.startsWith('DELETE')||q.startsWith('UPDATE subscriptions')).every(q=>q.includes('LIMIT ?')));
});
