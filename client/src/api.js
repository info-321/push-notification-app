export const API_BASE = (process.env.REACT_APP_API_BASE || 'http://localhost:5000').replace(/\/$/, '');
let csrfToken='';
export const authEpoch=()=>localStorage.getItem('notizo.authChange')||'';
export function authChanged(){localStorage.removeItem('sessionToken');localStorage.setItem('notizo.authChange',String(Date.now())+Math.random().toString(36));}
export function acceptSession(data){if(typeof data.csrfToken==='string')csrfToken=data.csrfToken;localStorage.removeItem('sessionToken');}
export async function browserSession({signal}={}){
  localStorage.removeItem('sessionToken');
  const response=await fetch(`${API_BASE}/api/auth/session`,{credentials:'include',cache:'no-store',signal});
  const data=await response.json();
  if(!response.ok||!data.ok||!data.csrfToken)throw new Error('Could not check your session. Please try again.');
  acceptSession(data);return data;
}
export async function apiFetch(url,options={}){
  const {authFailure=true,csrfRetry=true,...init}=options;
  if(!['http:','https:'].includes(new URL(url,window.location.origin).protocol)||new URL(url,window.location.origin).origin!==new URL(API_BASE,window.location.origin).origin)throw new Error('Dashboard requests must use the configured API.');
  const epoch=authEpoch(),headers=new Headers(init.headers||{});
  headers.delete('Authorization');
  if(!['GET','HEAD','OPTIONS'].includes((init.method||'GET').toUpperCase())){
    if(!csrfToken)await browserSession({signal:init.signal});
    headers.set('X-CSRF-Token',csrfToken);
  }
  const response=await fetch(url,{...init,headers,credentials:'include'});
  if(response.status===403&&csrfRetry&&(await response.clone().json().catch(()=>({}))).code==='CSRF'){
    await browserSession({signal:init.signal});return apiFetch(url,{...options,csrfRetry:false});
  }
  if(response.status===401&&authFailure&&authEpoch()===epoch){
    csrfToken='';localStorage.removeItem('auth');authChanged();window.dispatchEvent(new Event('auth-expired'));
  }
  return response;
}
