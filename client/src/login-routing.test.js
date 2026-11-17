import {safeLoginDestination,permittedLoginDestination,saveLoginReturn,readLoginReturn,clearLoginReturn} from './login-routing';
beforeEach(()=>sessionStorage.clear());
test('return destinations reject external or unknown URLs and strip unrelated query data',()=>{
  for(const path of ['https://evil.test','//evil.test/dashboard','/\\evil.test','/login','/unknown','/analytics?domain=bad%20key','/dashboard\n'])expect(safeLoginDestination(path)).toBeNull();
  expect(safeLoginDestination('/analytics?domain=site-one&password=never-store#other')).toBe('/analytics?domain=site-one');
  expect(safeLoginDestination('/settings/config?domain=one#send-push')).toBe('/settings/config?domain=one#send-push');
});
test('each resumed route is checked against current account role and assigned websites',()=>{
  const domains=[{domain_key:'one'}];
  expect(permittedLoginDestination('/analytics?domain=one',{role:'viewer'},domains)).toBe('/analytics?domain=one');
  expect(permittedLoginDestination('/analytics?domain=two',{role:'admin'},domains)).toBeNull();
  expect(permittedLoginDestination('/push?domain=one',{role:'viewer'},domains)).toBeNull();
  expect(permittedLoginDestination('/settings/users',{role:'editor'},domains)).toBeNull();
  expect(permittedLoginDestination('/settings/users',{role:'admin'},domains)).toBe('/settings/users');
  expect(permittedLoginDestination('/push',{role:'admin'},domains)).toBeNull();
});
test('return paths are per-tab, expire after 30 minutes and clear on explicit sign out',()=>{
  saveLoginReturn('/analytics?domain=one');expect(readLoginReturn()).toBe('/analytics?domain=one');
  sessionStorage.setItem('notizo.signInReturn',JSON.stringify({path:'/analytics?domain=one',time:Date.now()-31*60000}));expect(readLoginReturn()).toBeNull();
  saveLoginReturn('/settings/account');clearLoginReturn();expect(readLoginReturn()).toBeNull();
  expect(localStorage.getItem('notizo.signInReturn')).toBeNull();
});
