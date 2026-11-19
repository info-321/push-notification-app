import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import RecoverySettings from './RecoverySettings';
import {apiFetch} from '../../api';
jest.mock('../../api',()=>({API_BASE:'https://api.test',apiFetch:jest.fn()}));
const reply=(data,ok=true,message)=>({ok,json:async()=>({ok,data,message})});
beforeEach(()=>{jest.resetAllMocks();localStorage.clear();});

test('verification stays pending until refreshed and never replaces the verified address prematurely',async()=>{
  let verified=false;
  apiFetch.mockImplementation(async(url,options)=>options?.method==='POST'?reply(null,true,'Check your inbox.'):reply({mail_enabled:true,verified_email:verified?'new@example.test':'old@example.test',pending_email:verified?null:undefined}));
  render(<RecoverySettings/>);await screen.findByText('old@example.test');await waitFor(()=>expect(screen.getByLabelText('Recovery email address')).toBeEnabled());
  expect(screen.getByLabelText('Recovery email address')).toHaveValue('old@example.test');
  fireEvent.change(screen.getByLabelText('Recovery email address'),{target:{value:'NEW@example.test'}});fireEvent.change(screen.getByLabelText('Current Notizo password'),{target:{value:'Fixture-password-123'}});
  fireEvent.click(screen.getByRole('button',{name:'Send verification email'}));await screen.findByText('Check your inbox.');
  const post=apiFetch.mock.calls.find(([,options])=>options?.method==='POST');expect(JSON.parse(post[1].body)).toEqual({email:'new@example.test',password:'Fixture-password-123'});expect(screen.getByText('old@example.test')).toBeInTheDocument();expect(screen.getByText('Awaiting verification')).toBeInTheDocument();expect(screen.getByLabelText('Current Notizo password')).toHaveValue('');expect(localStorage.length).toBe(0);
  verified=true;fireEvent.click(screen.getByRole('button',{name:'Refresh recovery status'}));await waitFor(()=>expect(screen.queryByText('old@example.test')).not.toBeInTheDocument());expect(screen.getByText('new@example.test')).toBeInTheDocument();expect(screen.queryByText('Awaiting verification')).not.toBeInTheDocument();
});

test('wrong-password and delivery errors preserve the verified email and clear the password',async()=>{
  apiFetch.mockImplementation(async(url,options)=>options?.method==='POST'?reply(null,false,'Current password is incorrect.'):reply({mail_enabled:true,verified_email:'owner@example.test'}));
  render(<RecoverySettings/>);await screen.findByText('owner@example.test');await waitFor(()=>expect(screen.getByLabelText('Current Notizo password')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Recovery email address'),{target:{value:'replacement@example.test'}});fireEvent.change(screen.getByLabelText('Current Notizo password'),{target:{value:'wrong'}});fireEvent.click(screen.getByRole('button',{name:'Send verification email'}));await screen.findByRole('alert');expect(screen.getByText('owner@example.test')).toBeInTheDocument();expect(screen.queryByText('Awaiting verification')).not.toBeInTheDocument();expect(screen.getByLabelText('Current Notizo password')).toHaveValue('');
});

test('unavailable delivery disables verification while status can be refreshed',async()=>{
  apiFetch.mockResolvedValue(reply({mail_enabled:false}));render(<RecoverySettings/>);await screen.findByText(/Email delivery is unavailable/);expect(screen.getByRole('button',{name:'Send verification email'})).toBeDisabled();expect(screen.getByLabelText('Recovery email address')).toBeDisabled();expect(screen.getByRole('button',{name:'Refresh recovery status'})).toBeEnabled();
});

test('load failures can be retried and a status refresh preserves an unsaved email draft',async()=>{
  apiFetch.mockRejectedValueOnce(new Error('Connection failed.')).mockResolvedValue(reply({mail_enabled:true,verified_email:'saved@example.test'}));render(<RecoverySettings/>);await screen.findByText('Connection failed.');fireEvent.click(screen.getByRole('button',{name:'Refresh recovery status'}));await screen.findByText('saved@example.test');await waitFor(()=>expect(screen.getByLabelText('Recovery email address')).toBeEnabled());fireEvent.change(screen.getByLabelText('Recovery email address'),{target:{value:'draft@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Refresh recovery status'}));await waitFor(()=>expect(screen.getByLabelText('Recovery email address')).toBeEnabled());expect(screen.getByLabelText('Recovery email address')).toHaveValue('draft@example.test');
});
