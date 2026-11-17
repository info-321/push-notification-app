import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import Recovery from './Recovery';
import {apiFetch} from '../../api';
jest.mock('../../api',()=>({API_BASE:'https://api.test',apiFetch:jest.fn(),authChanged:jest.fn()}));
beforeEach(()=>{jest.clearAllMocks();});
test('forgot password explains absent SMTP and does not pretend a link was sent',async()=>{
  apiFetch.mockResolvedValue({ok:false,json:async()=>({ok:false,message:'Password-reset email is not configured yet. Contact your administrator for help.'})});
  render(<Recovery kind="forgot" onBack={()=>{}}/>);fireEvent.change(screen.getByLabelText('Username'),{target:{value:'owner'}});fireEvent.click(screen.getByRole('button',{name:'Send reset link'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('not configured yet');expect(screen.queryByRole('status')).toBeNull();
});
test('reset requires confirmation and sends only the token/new password, then returns users to sign in',async()=>{
  const back=jest.fn();apiFetch.mockResolvedValue({ok:true,json:async()=>({ok:true,message:'Password reset. Sign in again.'})});render(<Recovery kind="reset" token="fixture-reset" onBack={back}/>);
  fireEvent.change(screen.getByLabelText('New password'),{target:{value:'New-fixture-password'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'Different-fixture-password'}});fireEvent.click(screen.getByRole('button',{name:'Reset password'}));
  expect(screen.getByRole('alert')).toHaveTextContent('match');expect(apiFetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'New-fixture-password'}});fireEvent.click(screen.getByRole('button',{name:'Reset password'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Password reset'));expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({token:'fixture-reset',password:'New-fixture-password'});fireEvent.click(screen.getByRole('button',{name:'Back to sign in'}));expect(back).toHaveBeenCalled();
});
test('verification requires an explicit click, so email link scanners do not consume it on load',async()=>{
  apiFetch.mockResolvedValue({ok:true,json:async()=>({ok:true,message:'Recovery email verified.'})});render(<Recovery kind="verify" token="fixture-verification" onBack={()=>{}}/>);expect(apiFetch).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Verify email address'}));expect(await screen.findByRole('status')).toHaveTextContent('verified');
});
