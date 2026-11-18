import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import AccountAudit from './AccountAudit';
import {apiFetch,protectedFetch} from '../../api';
jest.mock('../../api',()=>({API_BASE:'https://api.test',apiFetch:jest.fn(),protectedFetch:jest.fn()}));
const ok=data=>({ok:true,json:async()=>({ok:true,data})});
const data={current_user_id:1,accounts:[{id:1,username:'Owner',role:'superadmin',is_active:true},{id:2,username:'Editor',role:'editor',is_active:true,created:{actor_name:'Owner',time_ms:1000}}],rows:[],has_more:false};
beforeEach(()=>{jest.resetAllMocks();apiFetch.mockResolvedValue(ok(data));});

test('history displays missing metadata and disables resetting the current account',async()=>{
  render(<AccountAudit/>);await screen.findByRole('button',{name:'Reset password for Editor'});
  expect(screen.getByRole('button',{name:'Reset password for Owner'})).toBeDisabled();expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  expect(screen.getByRole('button',{name:'Older account events'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('History for account'),{target:{value:'2'}});
  await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/platform/account-history?offset=0&user_id=2'));
});

test('reset uses protected confirmation, displays the link once and clears it on dismissal',async()=>{
  const url='https://api.test/login#reset=private-test-token';protectedFetch.mockResolvedValue(ok({username:'Editor',reset_url:url,expires_ms:Date.now()+900000}));
  render(<AccountAudit/>);fireEvent.click(await screen.findByRole('button',{name:'Reset password for Editor'}));
  fireEvent.change(screen.getByLabelText('Reset reason'),{target:{value:'Verified account holder request'}});fireEvent.click(screen.getByRole('button',{name:'Confirm and create reset link'}));
  await screen.findByLabelText('Reset link');expect(protectedFetch.mock.calls[0][0]).toBe('https://api.test/api/platform/accounts/2/reset-password');expect(JSON.parse(protectedFetch.mock.calls[0][1].body)).toEqual({reason:'Verified account holder request'});
  expect(screen.getByLabelText('Reset link')).toHaveAttribute('type','password');expect(screen.getByLabelText('Reset link')).toHaveValue(url);
  fireEvent.click(screen.getByRole('button',{name:'Dismiss private link'}));expect(screen.queryByLabelText('Reset link')).not.toBeInTheDocument();expect(localStorage.length).toBe(0);
});
