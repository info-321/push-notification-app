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

test('activated Admins see assigned website grants and cannot select administrator roles',async()=>{
  apiFetch.mockImplementation(async url=>{
    if(url.endsWith('/api/account'))return response({id:2,username:'team-admin',role:'admin',platform_enabled:true});
    if(url.endsWith('/api/users'))return response([{id:2,username:'team-admin',role:'admin',domains:['one'],is_active:true}]);
    if(url.endsWith('/api/domains'))return response([{domain_key:'one',domain_name:'one.test'}]);
    return response([]);
  });
  render(<UserManagement/>);await screen.findByText('team-admin');
  expect(screen.queryByRole('option',{name:'Administrator'})).not.toBeInTheDocument();expect(screen.queryByRole('option',{name:/Superadmin/})).not.toBeInTheDocument();expect(screen.getByRole('option',{name:'Editor'})).toBeInTheDocument();expect(screen.getByLabelText('one.test')).toBeInTheDocument();
});
