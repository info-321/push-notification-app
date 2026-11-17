// Operator-only CLI inside the API container. Preview is the default; there is
// deliberately no public HTTP endpoint that can delete retention data.
import mysql from 'mysql2/promise';
import {runRetention,retentionPolicy} from './retention.js';

try {
  const args=process.argv.slice(2),settings={};let apply=false;
  for(const arg of args){
    if(arg==='--apply'){apply=true;continue;}
    const match=arg.match(/^--(days|auditDays|batch|maxBatches)=(\d+)$/);
    if(!match)throw new Error('Usage: node maintenance.js [--apply] [--days=90] [--auditDays=365] [--batch=500] [--maxBatches=20]');
    settings[match[1]]=Number(match[2]);
  }
  const policy=retentionPolicy(settings);
  if(!process.env.DB_HOST||!process.env.DB_NAME||!process.env.DB_USER)throw new Error('Run inside the configured API container.');
  const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:2,timezone:'Z'});
  try {console.log(JSON.stringify(await runRetention(pool,{apply,policy}),null,2));}finally{await pool.end();}
}catch(error){console.error(error.code?'Retention failed: '+error.code:error.message);process.exitCode=1;}
