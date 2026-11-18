import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';

export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const fingerprint=value=>crypto.createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
export function platformCrypto(master){
  const key=Buffer.from(crypto.hkdfSync('sha256',master,'Notizo','platform-security-v1',32));
  return {
    encrypt(value,context){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(context));const body=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),body.toString('base64url')].join('.');},
    decrypt(value,context){const [v,iv,tag,body]=String(value||'').split('.');if(v!=='v1')throw new Error('Invalid encrypted value.');const c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));c.setAAD(Buffer.from(context));c.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([c.update(Buffer.from(body,'base64url')),c.final()]).toString('utf8'));},
    codeHash(id,code){return crypto.createHmac('sha256',key).update(`recovery:${id}:${String(code).replace(/-/g,'').toLowerCase()}`).digest('hex');},
  };
}
export const newMfa=()=>new OTPAuth.Secret({size:20}).base32;
export function totp(secret,username='Notizo'){return new OTPAuth.TOTP({issuer:'Notizo',label:username,algorithm:'SHA1',digits:6,period:30,secret:OTPAuth.Secret.fromBase32(secret)});}
export function consumeMfa(row,code,crypt,id,now=Date.now()){
  if(!row?.enabled||typeof code!=='string')return false;
  if(/^\d{6}$/.test(code)){
    const seed=crypt.decrypt(row.secret_cipher,`mfa:${id}`),delta=totp(seed).validate({token:code,window:1,timestamp:now});
    const counter=Math.floor(now/30000)+(delta||0);
    if(delta===null||counter<=Number(row.last_counter??-1))return false;
    row.last_counter=counter;return true;
  }
  if(!/^[a-fA-F0-9-]{20,24}$/.test(code))return false;
  const hash=crypt.codeHash(id,code),index=(row.recovery||[]).findIndex(saved=>saved===hash);
  if(index<0)return false;row.recovery.splice(index,1);return true;
}
export function recoveryCodes(crypt,id){const codes=Array.from({length:10},()=>crypto.randomBytes(10).toString('hex').match(/.{1,5}/g).join('-'));return {codes,hashes:codes.map(c=>crypt.codeHash(id,c))};}
export const requestFingerprint=req=>fingerprint({method:req.method.toUpperCase(),path:new URL(req.originalUrl,'http://notizo.internal').pathname,body:req.body||{}});
export const defaultPlatform=()=>({enabled:false,owner_id:null,sends_paused:false,policy:{session_hours:12,require_admin_mfa:false,subscriber_exports:false}});
export const appError=(message,status=400,code)=>Object.assign(new Error(message),{status,code});
