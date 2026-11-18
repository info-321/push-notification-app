import crypto from 'node:crypto';
import {createRecoveryMailer,validMailbox} from './mail.js';
import {platformCrypto,appError} from './platform-crypto.js';
export function managedMailer({accounts,secret,fallback={enabled:false},env=process.env}){
  const crypt=platformCrypto(secret);let cachedValue,cachedMailer;
  const settings=async()=>{
    const value=await accounts.platformConfig('smtp');
    return value?crypt.decrypt(value,'platform:smtp'):{enabled:Boolean(fallback.enabled),host:env.SMTP_HOST||'',port:Number(env.SMTP_PORT||587),user:env.SMTP_USER||'',password:env.SMTP_PASSWORD||'',from:env.SMTP_FROM||''};
  };
  const make=s=>createRecoveryMailer({MAIL_ENABLED:s.enabled?'true':'false',SMTP_HOST:s.host,SMTP_PORT:s.port,SMTP_USER:s.user,SMTP_PASSWORD:s.password,SMTP_FROM:s.from});
  return {enabled:Boolean(fallback.enabled),settings,
    async available(){return Boolean((await settings()).enabled);},
    async send(message){const raw=await accounts.platformConfig('smtp');if(!raw)return fallback.send(message);if(raw!==cachedValue){cachedMailer=make(crypt.decrypt(raw,'platform:smtp'));cachedValue=raw;}if(!cachedMailer.enabled)throw new Error('Mail disabled.');return cachedMailer.send(message);},
    async publicSettings(){const s=await settings();return {enabled:s.enabled,host:s.host,port:s.port,user:s.user,from:s.from,password_set:Boolean(s.password)};},
    async candidate(input){if(!input||typeof input.enabled!=='boolean'||Object.keys(input).some(x=>!['host','port','user','password','from','enabled'].includes(x)))throw appError('Enter supported SMTP settings.');const previous=await settings();if(!input.password&&(input.host!==previous.host||input.user!==previous.user))throw appError('Enter a new SMTP password when changing the host or username.');const s={...input,password:input.password||previous.password};if(typeof s.host!=='string'||!/^[A-Za-z0-9.-]{1,253}$/.test(s.host)||!validMailbox(s.from)||typeof s.user!=='string'||!s.user||s.user.length>254||typeof s.password!=='string'||s.password.length>1024||![465,587].includes(Number(s.port)))throw appError('Enter a mail host, port 465/587, username and sender address.');s.port=Number(s.port);return s;},
    async verify(s){if(s.enabled)await make(s).verify();},
    encrypt:s=>crypt.encrypt(s,'platform:smtp'),
  };
}
export async function senderKeyFor(accounts,secret,key){const epoch=Number(await accounts.platformConfig(`sender:${key}`)||0);return crypto.createHmac('sha256',secret).update(epoch?`send:${key}:epoch:${epoch}`:`send:${key}`).digest('base64url');}
export async function platformSendingPaused(pool,domainKey){
  let state;
  if(pool.notizoPlatformStatus)state=await pool.notizoPlatformStatus();
  else {if(!pool.notizoPlatform)return false;state=(await pool.query('SELECT enabled,sends_paused FROM platform_state WHERE id=1'))[0][0];if(!state)throw new Error('Platform state unavailable.');}
  if(!state.enabled)return false;
  if(state.sends_paused)return true;
  if(!domainKey)return false;
  const value=pool.notizoPlatformConfig?await pool.notizoPlatformConfig(`pause:${domainKey}`):(await pool.query('SELECT value FROM platform_config WHERE name=?',[`pause:${domainKey}`]))[0][0]?.value;
  return value==='true';
}
