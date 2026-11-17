// Only known internal destinations and non-sensitive route parameters survive a
// sign-in. Never store credentials or trust an arbitrary external next URL.
const key='notizo.signInReturn';
const paths=new Set(['/dashboard','/push','/push/reports','/push/schedules','/push/settings','/analytics','/settings','/settings/general','/settings/account','/settings/users','/settings/domains','/settings/domain','/settings/config','/settings/pwa']);
export function safeLoginDestination(value) {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.length>600||Array.from(value).some(char=>char.charCodeAt(0)<=32||char==='\\'))return null;
  try {
    const url=new URL(value,'https://notizo.internal');
    if(url.origin!=='https://notizo.internal'||!paths.has(url.pathname))return null;
    const domain=url.searchParams.get('domain'),query=new URLSearchParams();
    if(domain){if(!/^[A-Za-z0-9_-]{1,64}$/.test(domain))return null;query.set('domain',domain);}
    const copy=url.searchParams.get('copy');
    if(url.pathname==='/push'&&domain&&/^[a-f0-9-]{36}$/.test(copy||''))query.set('copy',copy);
    return url.pathname+(query.toString()?'?'+query.toString():'')+(url.pathname==='/settings/config'&&url.hash==='#send-push'?'#send-push':'');
  }catch{return null;}
}
export function readLoginReturn() {
  try{const value=JSON.parse(sessionStorage.getItem(key));if(value&&Number.isFinite(value.time)&&Date.now()-value.time>=0&&Date.now()-value.time<30*60000)return safeLoginDestination(value.path);}catch{}
  clearLoginReturn();return null;
}
export function saveLoginReturn(value){const path=safeLoginDestination(value);try{if(path)sessionStorage.setItem(key,JSON.stringify({path,time:Date.now()}));}catch{}return path;}
export function clearLoginReturn(){try{sessionStorage.removeItem(key);}catch{}}
export function permittedLoginDestination(value,profile,domains) {
  const path=safeLoginDestination(value);
  if(!path||!profile||!Array.isArray(domains)||!['admin','editor','viewer'].includes(profile.role))return null;
  const url=new URL(path,'https://notizo.internal'),domain=url.searchParams.get('domain');
  if(domain&&!domains.some(site=>site.domain_key===domain))return null;
  if(['/settings/users','/settings/domain'].includes(url.pathname)&&profile.role!=='admin')return null;
  if(['/push','/push/settings','/settings/config'].includes(url.pathname)&&profile.role==='viewer')return null;
  if(['/push','/push/reports','/push/schedules','/push/settings','/analytics','/settings/config'].includes(url.pathname)&&!domain)return null;
  return path;
}
