import crypto from 'node:crypto';
import {hashPassword} from './accounts.js';
import {appError} from './platform-crypto.js';

export function userResetHandler({accounts,dashboardBase}){return async(req,res)=>{
  const id=Number(req.params.id),{reason}=req.body||{};
  if(!Number.isSafeInteger(id)||id<1||Object.keys(req.body||{}).some(k=>k!=='reason')||typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw appError('Choose an account and enter a reason of 10-500 characters.');
  const token=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(token).digest('hex');
  const result=await accounts.startManagedReset(req.auth,id,hash,await hashPassword(crypto.randomBytes(48).toString('base64url')),reason.trim());
  const url=new URL('/login',dashboardBase);url.hash=new URLSearchParams({reset:token}).toString();
  res.json({ok:true,data:{...result,reset_url:url.href},message:'Old password and sessions revoked. Share this single-use link privately; it expires in 15 minutes. Two-factor authentication is unchanged.'});
};}
