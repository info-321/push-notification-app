import {API_BASE,apiFetch,protectedFetch,browserSession,acceptSession,authChanged} from './api';
const response=(status,data)=>({status,ok:status<400,json:async()=>data,clone(){return response(status,data);}});
beforeEach(()=>{localStorage.clear();acceptSession({csrfToken:''});global.fetch=jest.fn();});
test('bootstrap checks the cookie, deletes legacy credentials and never exposes them in request headers',async()=>{
  localStorage.setItem('sessionToken','old-bearer');fetch.mockResolvedValueOnce(response(200,{ok:true,authenticated:true,csrfToken:'csrf'}));
  expect((await browserSession()).authenticated).toBe(true);expect(localStorage.getItem('sessionToken')).toBeNull();
  fetch.mockResolvedValueOnce(response(200,{ok:true}));await apiFetch(API_BASE+'/api/account/heartbeat',{method:'POST',headers:{Authorization:'Bearer forbidden'}});
  const init=fetch.mock.calls[1][1];expect(init.credentials).toBe('include');expect(init.headers.get('X-CSRF-Token')).toBe('csrf');expect(init.headers.has('Authorization')).toBe(false);
});
test('stale CSRF is refreshed once without retrying unrelated errors or looping',async()=>{
  acceptSession({csrfToken:'stale'});fetch.mockResolvedValueOnce(response(403,{code:'CSRF'})).mockResolvedValueOnce(response(200,{ok:true,csrfToken:'current',authenticated:true})).mockResolvedValueOnce(response(200,{ok:true}));
  expect((await apiFetch(API_BASE+'/api/logout',{method:'POST'})).status).toBe(200);expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls[2][1].headers.get('X-CSRF-Token')).toBe('current');
  fetch.mockResolvedValueOnce(response(403,{code:'ACCESS'}));expect((await apiFetch(API_BASE+'/api/logout',{method:'POST'})).status).toBe(403);expect(fetch).toHaveBeenCalledTimes(4);
});
test('requests cannot send credentials to arbitrary origins; a late 401 cannot expire a newer session',async()=>{
  await expect(apiFetch('https://unrelated.example/api/account')).rejects.toThrow('configured API');expect(fetch).not.toHaveBeenCalled();
  let complete;fetch.mockImplementation(()=>new Promise(r=>{complete=r;}));const listener=jest.fn();window.addEventListener('auth-expired',listener);
  const pending=apiFetch(API_BASE+'/api/account');authChanged();complete(response(401,{ok:false}));await pending;expect(listener).not.toHaveBeenCalled();window.removeEventListener('auth-expired',listener);
});

test('protected requests wait for a one-use confirmation and keep credentials out of storage',async()=>{
  acceptSession({csrfToken:'fixture'});const body=JSON.stringify({paused:true});
  fetch.mockResolvedValueOnce(response(403,{code:'STEP_UP_REQUIRED'})).mockResolvedValueOnce(response(200,{ok:true}));
  const receive=e=>{expect(e.detail.request).toEqual({method:'POST',path:'/api/platform/pause',body:{paused:true}});e.detail.resolve('opaque-approval');};
  window.addEventListener('notizo-confirm',receive);
  const result=await protectedFetch(API_BASE+'/api/platform/pause',{method:'POST',headers:{'Content-Type':'application/json'},body});
  expect(result.status).toBe(200);expect(fetch.mock.calls[1][1].headers.get('X-Notizo-Approval')).toBe('opaque-approval');expect(JSON.stringify({...localStorage})).not.toContain('opaque-approval');window.removeEventListener('notizo-confirm',receive);
});
