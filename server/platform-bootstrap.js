// Trusted interactive host operation. Never use through the restricted CI key.
import mysql from 'mysql2/promise';
import {accountEvent,addAccountEvent} from './account-events.js';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {mysqlAccountRepository,hashPassword} from './accounts.js';
import {rotateAccess} from './platform-store.js';
import {appError} from './platform-crypto.js';

export function activatePlatform(d,{username,passwordHash,assignments,domainKeys}){
  if(d.state.enabled)throw appError('Platform roles are already activated. Manage access in Platform Administration.');
  let owner=Object.values(d.users).find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(owner&&!owner.is_active)throw appError('The selected account is disabled. Resolve its status before activation.');
  const admins=Object.values(d.users).filter(u=>u.role==='admin'&&u.id!==owner?.id);
  if(admins.some(u=>!Object.hasOwn(assignments,u.id)))throw appError('Explicit website assignments are required for every existing Admin.');
  for(const keys of Object.values(assignments))if(!Array.isArray(keys)||keys.some(k=>!domainKeys.includes(k)))throw appError('Invalid website assignment.');
  const creating=!owner;
  if(!owner){if(!passwordHash)throw appError('A private password is required for the new owner.');const id=Math.max(0,...Object.keys(d.users).map(Number))+1;owner={id,username,password_hash:passwordHash,is_active:1,access_version:1,session_version:crypto.randomUUID()};d.users[id]=owner;}
  owner.role='superadmin';d.grants[owner.id]=[];rotateAccess(owner);
  for(const u of admins){d.grants[u.id]=assignments[u.id];rotateAccess(u);}
  d.state.enabled=true;d.state.owner_id=owner.id;
  const id=crypto.randomUUID();d.operations[id]={id,kind:'bootstrap',status:'completed',actor_id:owner.id,created_ms:Date.now(),details:{username,assigned_admins:admins.map(u=>u.id)}};
  addAccountEvent(d,accountEvent(creating?'account_created':'account_access_changed',{id:0,username:'Host operator'},owner,{source:'host_setup'}));
  return owner.id;
}
export async function platformDb(){return mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:2});}
async function main(){
  if(!process.stdin.isTTY)throw new Error('Use an interactive Hostinger terminal: docker compose exec api node platform-bootstrap.js Superadmin');
  const username=process.argv[2];if(!username||username.length>255)throw new Error('Supply the intended username only.');
  const pool=await platformDb(),accounts=mysqlAccountRepository(pool);
  let muted=false;const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}}),rl=readline.createInterface({input:process.stdin,output,terminal:true});
  const privateQuestion=async label=>{process.stdout.write(label);muted=true;try{return await rl.question('');}finally{muted=false;process.stdout.write('\n');}};
  try{
    const d=await accounts.platformRead();if(d.state.enabled)throw new Error('Already activated. Use Platform Administration.');
    const existing=Object.values(d.users).find(u=>u.username.toLowerCase()===username.toLowerCase());let passwordHash;
    if(!existing){const password=await privateQuestion('New owner password (12-128 characters; hidden): '),confirm=await privateQuestion('Confirm owner password: ');if(password.length<12||password.length>128||password!==confirm)throw new Error('Passwords did not match or length was invalid. Nothing changed.');passwordHash=await hashPassword(password);}
    const [domains]=await pool.query('SELECT domain_key,domain_name FROM domains WHERE user_id=1');
    console.log('Existing websites:');domains.forEach((s,i)=>console.log(`${i+1}. ${s.domain_name}`));
    const assignments={};for(const u of Object.values(d.users).filter(u=>u.role==='admin'&&u.id!==existing?.id)){
      const text=await rl.question(`Websites for Admin ${u.username}: comma-separated numbers, or "none": `);const numbers=text.trim()==='none'?[]:text.split(',').map(v=>Number(v.trim()));
      if(numbers.some(n=>!Number.isInteger(n)||!domains[n-1])||new Set(numbers).size!==numbers.length)throw new Error('Invalid selection. Nothing changed.');assignments[u.id]=numbers.map(n=>domains[n-1].domain_key);
    }
    console.log(`Owner: ${username}. Other Admins will receive only the selected websites. Their sessions will be revoked.`);
    if(await rl.question('Type ACTIVATE to continue: ')!=='ACTIVATE')throw new Error('Cancelled. Nothing changed.');
    const id=await accounts.platformAtomic(current=>activatePlatform(current,{username,passwordHash,assignments,domainKeys:domains.map(s=>s.domain_key)}));
    const audit=await accounts.audit({actor_id:id,actor_name:username,domain_key:null,action:'platform/bootstrap',method:'CLI'});await accounts.finishAudit(audit,200);
    console.log('Activated. Sign in as the owner and enroll an authenticator. Save the recovery codes privately.');
  }finally{rl.close();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Activation did not complete. Check the username, assignments and database availability. No credentials were displayed.');process.exitCode=1;});
