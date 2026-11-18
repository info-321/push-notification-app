// Host-only metadata catalog. No backup contents or credentials enter the UI.
import crypto from 'node:crypto';
import {platformDb} from './platform-bootstrap.js';
import {mysqlAccountRepository} from './accounts.js';
const [command,value,checksum]=process.argv.slice(2);
const pool=await platformDb(),accounts=mysqlAccountRepository(pool);
try{
  if(command==='record-backup'){
    if(!/^\d{8}T\d{6}Z-[A-Za-z0-9]+$/.test(value||'')||!/^[a-f0-9]{64}$/.test(checksum||''))throw new Error('Invalid backup metadata.');
    const id=crypto.randomUUID();await accounts.platformAtomic(d=>{d.operations[id]={id,kind:'backup',status:'completed',actor_id:0,created_ms:Date.now(),details:{snapshot:value,manifest_sha256:checksum}};});
    console.log('Backup catalog updated.');
  }else if(command==='restore-plan'){
    const d=await accounts.platformRead(),o=d.operations[value],owner=d.users[o?.actor_id];
    if(o?.kind!=='restore'||o.status!=='approved'||Date.now()-o.created_ms>3600000||!owner?.is_active||owner.role!=='superadmin'||!d.mfa[owner.id]?.enabled||o.details.authorizer_version!==owner.session_version)throw new Error('A recent Superadmin restore approval is required.');
    console.log(JSON.stringify({approval:o.id,snapshot:o.details.snapshot,manifest_sha256:o.details.manifest_sha256,approved_by:owner.username,expires_ms:o.created_ms+3600000,note:'Verify checksum, use the isolated restore check, pause sending and coordinate downtime before an operator restores production.'}));
  }else throw new Error('Use record-backup or restore-plan.');
}catch{console.error('Platform operation could not be verified.');process.exitCode=1;}finally{await pool.end();}
