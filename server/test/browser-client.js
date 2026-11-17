// Adapts the older fixture helpers' session parameter to actual cookies/CSRF.
// The production JSON never contains a session token. New auth tests use native
// fetch to assert this boundary directly, including missing/invalid CSRF.
const sessions=new Map();
const nativeFetch=globalThis.fetch;
export async function fetch(url,options={}){
  const headers=new Headers(options.headers||{}),auth=headers.get('Authorization');
  if(auth?.startsWith('Bearer ')){
    const value=auth.slice(7),saved=sessions.get(value);
    if(saved){headers.delete('Authorization');headers.set('Cookie',saved.cookie);headers.set('X-CSRF-Token',saved.csrf);}
  }
  if(new URL(url).pathname==='/api/login'){
    const r=await nativeFetch(new URL('/api/auth/session',url));const d=await r.json();
    headers.set('Cookie',r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '));headers.set('X-CSRF-Token',d.csrfToken);
  }
  const response=await nativeFetch(url,{...options,headers});
  const cookie=response.headers.getSetCookie().find(c=>/^(?:__Host-)?notizo_session=./.test(c));
  if(cookie){
    const data=await response.clone().json();
    if(data.csrfToken){const value=cookie.split(';')[0].split('=').slice(1).join('=');sessions.set(value,{cookie:cookie.split(';')[0],csrf:data.csrfToken});const json=response.json.bind(response);response.json=async()=>({...await json(),token:value});}
  }
  return response;
}
