// Break-glass MFA recovery requires the operator's unrestricted SSH access.
import readline from 'node:readline/promises';
import crypto from 'node:crypto';
import {platformDb} from './platform-bootstrap.js';
import {mysqlAccountRepository} from './accounts.js';
import {rotateAccess} from './platform-store.js';
if(!process.stdin.isTTY){console.error('Use an interactive, trusted Hostinger terminal.');process.exit(1);}
const pool=await platformDb(),accounts=mysqlAccountRepository(pool),rl=readline.createInterface({input:process.stdin,output:process.stdout});
try{
  const username=process.argv[2],reason=await rl.question('Operator recovery reason (10-500 characters): ');
  if(!username||reason.trim().length<10||reason.length>500)throw new Error();
  if(await rl.question(`Revoke all sessions and require new MFA enrollment for ${username}? Type RECOVER: `)!=='RECOVER')throw new Error();
  await accounts.platformAtomic(d=>{
    const user=Object.values(d.users).find(u=>u.username===username&&u.is_active&&u.role==='superadmin');if(!d.state.enabled||!user)throw new Error();
    d.mfa[user.id]={user_id:user.id,enabled:false,last_counter:-1,recovery:[]};rotateAccess(user);
    const id=crypto.randomUUID();d.operations[id]={id,kind:'mfa_recovery',status:'completed',actor_id:0,created_ms:Date.now(),details:{user_id:user.id,reason:reason.trim()}};
  });
  console.log('Sessions revoked. The owner must sign in with the existing password and enroll a new authenticator.');
}catch{console.error('Recovery cancelled or unavailable. Verify the active owner username.');process.exitCode=1;}finally{rl.close();await pool.end();}
