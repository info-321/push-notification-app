import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import UserManagement from './UserManagement';
import AccountSecurity from './AccountSecurity';
import {apiFetch} from '../../api';
jest.mock('../../api',()=>({API_BASE:'https://api.test',apiFetch:jest.fn(),protectedFetch:(...args)=>require('../../api').apiFetch(...args),}));
const response=data=>({ok:true,json:async()=>({ok:true,data})});
beforeEach(()=>jest.resetAllMocks());
test('administrator creates a named editor with selected website access and clears the temporary password',async()=>{
  const users=[{id:1,username:'owner',role:'admin',is_active:true,domains:[],version:1}];
  apiFetch.mockImplementation(async(url,options)=>{
    if(url.endsWith('/api/account'))return response({id:1,username:'owner',role:'admin'});
    if(url.endsWith('/api/domains'))return response([{domain_key:'one',domain_name:'one.test'},{domain_key:'two',domain_name:'two.test'}]);
    if(url.includes('/login-attempts'))return response([]);
    if(options?.method==='POST'){const input=JSON.parse(options.body);users.push({...input,password:undefined,id:2,is_active:true,version:1});return response({id:2});}
    return response(users);
  });
  render(<UserManagement/>);
  await screen.findByRole('heading',{name:'Users and website access'});
  fireEvent.change(screen.getByLabelText('Username'),{target:{value:'editor@example.test'}});
  fireEvent.change(screen.getByLabelText('Temporary password'),{target:{value:'Strong-editor-password-123'}});
  fireEvent.click(screen.getByLabelText('one.test'));
  fireEvent.click(screen.getByRole('button',{name:'Create user'}));
  await screen.findByText(/User created/);
  const created=apiFetch.mock.calls.find(([,options])=>options?.method==='POST');
  expect(JSON.parse(created[1].body)).toMatchObject({username:'editor@example.test',role:'editor',domains:['one']});
  expect(screen.getByLabelText('Temporary password')).toHaveValue('');
  expect(screen.getByText('editor@example.test')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Delete user'})).not.toBeInTheDocument();
});
test('a non-administrator cannot see user-creation controls or request the user list',async()=>{
  apiFetch.mockResolvedValue(response({id:2,username:'viewer',role:'viewer'}));
  render(<UserManagement/>);await screen.findByText('Only administrators can create users and assign website access.');
  expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument();
  expect(apiFetch.mock.calls.every(([url])=>url.endsWith('/api/account'))).toBe(true);
});
test('session history distinguishes explicit logout, expiry and the current session; other sessions can be revoked',async()=>{
  const sessions=[{id:'current',current:true,status:'active',login_ms:1000,last_seen_ms:2000,expires_ms:Date.now()+60000,ip_address:'203.0.113.1',os:'Windows',browser:'Chrome',device:'desktop'},{id:'other',current:false,status:'active',login_ms:1000,last_seen_ms:2000,expires_ms:Date.now()+60000},{id:'ended',status:'ended',login_ms:1000,last_seen_ms:2000,ended_ms:3000,end_reason:'logout'},{id:'expired',status:'expired',login_ms:1000,last_seen_ms:2000,expires_ms:3000,end_reason:'expired'}];
  apiFetch.mockImplementation(async(url,options)=>{
    if(options?.method==='DELETE'){sessions[1].status='ended';sessions[1].end_reason='revoked';return response(null);}
    return response(url.includes('/sessions')?sessions:[]);
  });
  render(<AccountSecurity/>);await screen.findByText('203.0.113.1');
  expect(screen.getByText('Current session')).toBeInTheDocument();expect(screen.getByText('logout')).toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Revoke session'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Revoke session'}));
  await waitFor(()=>expect(apiFetch.mock.calls.some(([url,options])=>url.endsWith('/other')&&options?.method==='DELETE')).toBe(true));
  await screen.findByText('revoked');
  expect(screen.queryByText('raw-token')).not.toBeInTheDocument();
});

test('activated Admins can create scoped Admins without seeing private owner roles',async()=>{
  apiFetch.mockImplementation(async url=>{
    if(url.endsWith('/api/account'))return response({id:2,username:'team-admin',role:'admin',platform_enabled:true});
    if(url.endsWith('/api/users'))return response([{id:2,username:'team-admin',role:'admin',domains:['one'],is_active:true}]);
    if(url.endsWith('/api/domains'))return response([{domain_key:'one',domain_name:'one.test'}]);
    return response([]);
  });
  render(<UserManagement/>);await screen.findByText('team-admin');
  expect(screen.getByRole('option',{name:'Administrator'})).toBeInTheDocument();expect(screen.queryByRole('option',{name:/Superadmin/})).not.toBeInTheDocument();expect(screen.getByRole('option',{name:'Editor'})).toBeInTheDocument();expect(screen.getByLabelText('one.test')).toBeInTheDocument();expect(screen.queryByText(/Superadmin/i)).not.toBeInTheDocument();
});


test('Admin edits a team member username and password, with no option to promote the member to Admin',async()=>{
  let saved;const member={id:3,username:'Editor',role:'editor',domains:['one'],is_active:true,version:2,can_edit:true,can_reset:true};
  apiFetch.mockImplementation(async(url,options)=>{if(options?.method==='PATCH'){saved=JSON.parse(options.body);return response({id:3});}if(url.endsWith('/api/account'))return response({id:2,username:'Admin',role:'admin',platform_enabled:true});if(url.endsWith('/api/users'))return response([member]);if(url.endsWith('/api/domains'))return response([{domain_key:'one',domain_name:'one.test'}]);return response([]);});
  render(<UserManagement/>);fireEvent.click(await screen.findByRole('button',{name:'Edit user'}));fireEvent.change(screen.getByLabelText('Username'),{target:{value:'Renamed'}});fireEvent.change(screen.getByLabelText('New password (optional)'),{target:{value:'Changed-fixture-password-123'}});expect(screen.queryByRole('option',{name:'Administrator'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Save user'}));await screen.findByText(/User updated/);expect(saved).toMatchObject({username:'Renamed',password:'Changed-fixture-password-123',domains:['one'],version:2});expect(screen.queryByLabelText('New password (optional)')).not.toBeInTheDocument();
});

test('blank edit password is omitted and an independent Admin has no edit, reset or session actions',async()=>{
  let saved;const users=[{id:3,username:'Editor',role:'editor',domains:['one'],is_active:true,version:2,can_edit:true,can_reset:true},{id:4,username:'Peer',role:'admin',domains:['one'],is_active:true,can_edit:false,can_reset:false,can_view_sessions:false}];
  apiFetch.mockImplementation(async(url,options)=>{if(options?.method==='PATCH'){saved=JSON.parse(options.body);return response({id:3});}if(url.endsWith('/api/account'))return response({id:2,username:'Admin',role:'admin',platform_enabled:true});if(url.endsWith('/api/users'))return response(users);if(url.endsWith('/api/domains'))return response([{domain_key:'one',domain_name:'one.test'}]);return response([]);});
  render(<UserManagement/>);await screen.findByText('Peer');expect(screen.getAllByRole('button',{name:'Edit user'})).toHaveLength(1);expect(screen.queryByRole('button',{name:'Reset password for Peer'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Edit user'}));fireEvent.click(screen.getByRole('button',{name:'Save user'}));await screen.findByText(/User updated/);expect(saved).not.toHaveProperty('password');
});

test('team reset creates and dismisses a private link without putting it into browser storage',async()=>{
  apiFetch.mockImplementation(async(url,options)=>{if(url.endsWith('/reset-password'))return response({username:'Editor',reset_url:'https://api.test/login#reset=fixture-private-token',expires_ms:Date.now()+900000});if(url.endsWith('/api/account'))return response({id:2,username:'Admin',role:'admin',platform_enabled:true});if(url.endsWith('/api/users'))return response([{id:3,username:'Editor',role:'editor',domains:['one'],is_active:true,version:2,can_edit:true,can_reset:true}]);if(url.endsWith('/api/domains'))return response([{domain_key:'one',domain_name:'one.test'}]);return response([]);});
  render(<UserManagement/>);fireEvent.click(await screen.findByRole('button',{name:'Reset password for Editor'}));fireEvent.change(screen.getByLabelText('Reset reason'),{target:{value:'Verified account holder request'}});fireEvent.click(screen.getByRole('button',{name:'Create private reset link'}));await screen.findByLabelText('Private reset link');expect(screen.getByLabelText('Private reset link')).toHaveAttribute('type','password');expect(JSON.stringify(localStorage)).not.toContain('fixture-private-token');fireEvent.click(screen.getByRole('button',{name:'Dismiss private link'}));expect(screen.queryByLabelText('Private reset link')).not.toBeInTheDocument();
});
