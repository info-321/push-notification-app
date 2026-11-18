import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import '@testing-library/jest-dom';
import MfaSettings,{ConfirmAction} from './SecurityControls';
import {apiFetch,acceptSession} from '../../api';
jest.mock('../../api',()=>({API_BASE:'https://api.test',apiFetch:jest.fn(),acceptSession:jest.fn()}));
const reply=data=>({ok:true,json:async()=>({ok:true,...data})});
beforeEach(()=>{localStorage.clear();jest.resetAllMocks();});
test('mandatory enrollment shows private recovery codes once and requires acknowledgement',async()=>{
  let enabled=false;apiFetch.mockImplementation(async(url,options)=>{
    if(url.endsWith('/mfa'))return reply({data:{required:true,enabled}});
    if(url.endsWith('/start'))return reply({data:{secret:'FIXTURESETUP',qr:'data:image/png;base64,fixture'}});
    if(url.endsWith('/enable')){enabled=true;return reply({csrfToken:'updated',data:{recovery_codes:['fixture-recovery-1','fixture-recovery-2']}});}
    throw new Error('Unexpected route');
  });
  const done=jest.fn();render(<MfaSettings login onDone={done}/>);
  fireEvent.change(await screen.findByLabelText('Current password'),{target:{value:'private-fixture-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Set up authenticator'}));
  expect(await screen.findByText('FIXTURESETUP')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Authenticator code'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Enable two-factor authentication'}));
  expect(await screen.findByText('fixture-recovery-1')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Continue'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('I saved my recovery codes privately'));fireEvent.click(screen.getByRole('button',{name:'Continue'}));await waitFor(()=>expect(done).toHaveBeenCalled());
  expect(acceptSession).toHaveBeenCalledWith(expect.objectContaining({csrfToken:'updated'}));expect(JSON.stringify({...localStorage})).not.toContain('fixture');
});
test('login challenge accepts recovery codes and never offers mandatory MFA disable',async()=>{
  apiFetch.mockImplementation(async url=>url.endsWith('/verify')?reply({csrfToken:'verified'}):reply({data:{enabled:true,required:true}}));
  const done=jest.fn();render(<MfaSettings login onDone={done}/>);
  fireEvent.change(await screen.findByLabelText('Authenticator or recovery code'),{target:{value:'abcde-12345-abcde-12345'}});fireEvent.click(screen.getByRole('button',{name:'Verify sign-in'}));
  await waitFor(()=>expect(done).toHaveBeenCalled());expect(screen.queryByRole('button',{name:'Disable two-factor authentication'})).not.toBeInTheDocument();
});
test('protected action dialog binds credentials to requested body and returns only the one-use approval',async()=>{
  apiFetch.mockImplementation(async url=>url.endsWith('/step-up')?reply({approval:'fixture-approval'}):reply({data:{enabled:true}}));render(<ConfirmAction/>);
  const resolve=jest.fn(),reject=jest.fn(),request={method:'POST',path:'/api/platform/pause',body:{paused:true}};
  act(()=>window.dispatchEvent(new CustomEvent('notizo-confirm',{detail:{request,resolve,reject,label:'Pause all sending'}})));
  fireEvent.change(await screen.findByLabelText('Current password'),{target:{value:'private-password'}});fireEvent.change(screen.getByLabelText('Authenticator or recovery code'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  await waitFor(()=>expect(resolve).toHaveBeenCalledWith('fixture-approval'));
  const [,options]=apiFetch.mock.calls.find(([url])=>url.endsWith('/step-up'));expect(JSON.parse(options.body)).toEqual({password:'private-password',code:'123456',request});expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();expect(reject).not.toHaveBeenCalled();
});
