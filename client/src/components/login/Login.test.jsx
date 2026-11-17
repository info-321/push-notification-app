import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import '@testing-library/jest-dom';
import Login from './Login';
import {acceptSession} from '../../api';

const reply=(status,data={})=>({status,ok:status>=200&&status<300,json:async()=>data,headers:{get:()=>null}});
function fill(){fireEvent.change(screen.getByLabelText('Username'),{target:{value:'  editor@example.test  '}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:' Fixture-password-123 '}});}
beforeEach(()=>{window.history.replaceState({},'','/login');localStorage.clear();acceptSession({csrfToken:'fixture-csrf'});global.fetch=jest.fn(async()=>reply(200,{ok:true,csrfToken:'fixture-csrf'}));});
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();});

test('branded sign in has visible labels and password-manager attributes, without guessing an email-only username',()=>{
  render(<Login/>);
  expect(screen.getByRole('heading',{name:'Welcome back to Notizo'})).toBeInTheDocument();
  expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete','username');
  expect(screen.getByLabelText('Username')).toHaveAttribute('type','text');
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete','current-password');
  expect(screen.getByRole('button',{name:'Sign in'})).toBeEnabled();
});
test('password visibility and Caps Lock warning preserve the entered value',()=>{
  render(<Login/>);fill();const input=screen.getByLabelText('Password');
  fireEvent.click(screen.getByRole('button',{name:'Show password'}));expect(input).toHaveAttribute('type','text');expect(input.value).toBe(' Fixture-password-123 ');
  fireEvent.click(screen.getByRole('button',{name:'Hide password'}));expect(input).toHaveAttribute('type','password');
  const event=new KeyboardEvent('keydown',{key:'A',bubbles:true});Object.defineProperty(event,'getModifierState',{value:name=>name==='CapsLock'});fireEvent(input,event);
  expect(screen.getByText('Caps Lock is on.')).toBeInTheDocument();fireEvent.blur(input);expect(screen.queryByText('Caps Lock is on.')).toBeNull();
});
test('required-field errors are associated with inputs and never submit an empty form',()=>{
  render(<Login/>);fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your username');expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid','true');expect(fetch).not.toHaveBeenCalled();
});
test('successful login trims only the username and remembers it only when opted in',async()=>{
  const success=jest.fn();render(<Login onLoginSuccess={success}/>);fill();fireEvent.click(screen.getByLabelText('Remember username'));fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  await waitFor(()=>expect(success).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({username:'editor@example.test',password:' Fixture-password-123 '});
  expect(localStorage.getItem('notizo.rememberedUsername')).toBe('editor@example.test');expect(localStorage.getItem('sessionToken')).toBeNull();
  expect(JSON.stringify({...localStorage})).not.toContain('Fixture-password');expect(screen.getByLabelText('Password')).toHaveValue('');
});
test('remembered usernames can be removed immediately without signing in',()=>{
  localStorage.setItem('notizo.rememberedUsername','old-user');render(<Login/>);
  expect(screen.getByLabelText('Username')).toHaveValue('old-user');expect(screen.getByLabelText('Remember username')).toBeChecked();
  fireEvent.click(screen.getByLabelText('Remember username'));expect(localStorage.getItem('notizo.rememberedUsername')).toBeNull();
});
test('incorrect credentials and backend failures show safe, accessible messages',async()=>{
  fetch.mockResolvedValueOnce(reply(401,{message:'Database user secret-name does not exist'}));render(<Login/>);fill();fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't sign you in");expect(screen.queryByText(/secret-name/)).toBeNull();expect(localStorage.getItem('sessionToken')).toBeNull();
  fetch.mockResolvedValueOnce(reply(503));fireEvent.click(screen.getByRole('button',{name:'Sign in'}));expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
});
test('network errors and request timeouts offer a retry without raw exceptions',async()=>{
  fetch.mockRejectedValueOnce(new TypeError('Internal proxy details'));render(<Login/>);fill();fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect to Notizo');expect(screen.queryByText(/Internal proxy/)).toBeNull();
  jest.useFakeTimers();fetch.mockImplementationOnce((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error(),{name:'AbortError'})))));
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await act(async()=>{jest.advanceTimersByTime(15000);});
  expect(screen.getByRole('alert')).toHaveTextContent('timed out');expect(screen.getByRole('button',{name:'Sign in'})).toBeEnabled();
});
test('rate-limit feedback uses a countdown and cannot submit while waiting',async()=>{
  jest.useFakeTimers();fetch.mockResolvedValueOnce({...reply(429),headers:{get:()=> '2'}});
  render(<Login/>);fill();fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await act(async()=>{});
  expect(screen.getByRole('button',{name:'Try again in 0:02'})).toBeDisabled();await act(async()=>{jest.advanceTimersByTime(2000);});expect(screen.getByRole('button',{name:'Sign in'})).toBeEnabled();
});
test('repeated submissions are locked and a late response cannot replace another tab session',async()=>{
  let finish;fetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const success=jest.fn();render(<Login onLoginSuccess={success}/>);fill();const form=screen.getByRole('button',{name:'Sign in'}).closest('form');
  fireEvent.submit(form);fireEvent.submit(form);expect(fetch).toHaveBeenCalledTimes(1);
  localStorage.setItem('notizo.authChange','other-tab-change');await act(async()=>{finish(reply(200,{ok:true,csrfToken:'late-csrf'}));});
  expect(success).not.toHaveBeenCalled();expect(localStorage.getItem('notizo.authChange')).toBe('other-tab-change');expect(screen.getByRole('alert')).toHaveTextContent('another tab');
});
test('access help opens a real dialog, copies the request, traps focus and closes with Escape',async()=>{
  const writeText=jest.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  render(<Login/>);const trigger=screen.getByRole('button',{name:/Need access/});fireEvent.click(trigger);const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Access request').value).toContain('Websites I need to manage');
  expect(within(dialog).getByRole('link',{name:'ttwabhijit@gmail.com'})).toHaveAttribute('href',expect.stringContaining('mailto:ttwabhijit@gmail.com'));
  expect(within(dialog).getByRole('link',{name:'kaushik@travelandtourworld.com'})).toHaveAttribute('href',expect.stringContaining('mailto:kaushik@travelandtourworld.com'));
  const close=within(dialog).getByRole('button',{name:'Close access help'}),copy=within(dialog).getByRole('button',{name:'Copy access request'});
  fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(copy).toHaveFocus();fireEvent.click(copy);await waitFor(()=>expect(writeText).toHaveBeenCalled());
  await waitFor(()=>expect(within(dialog).getByRole('status')).toHaveTextContent('Copied'));fireEvent.keyDown(copy,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(trigger).toHaveFocus();
});

test('recovery links remove their fragment and a new link in the same tab opens a fresh recovery form',()=>{
  window.history.replaceState({},'','/login#reset=fixture-first');render(<Login/>);expect(screen.getByRole('heading',{name:'Choose a new password'})).toBeInTheDocument();expect(window.location.hash).toBe('');
  window.history.replaceState({},'','/login#verify=fixture-second');fireEvent(window,new HashChangeEvent('hashchange'));expect(screen.getByRole('heading',{name:'Verify recovery email'})).toBeInTheDocument();expect(window.location.hash).toBe('');expect(fetch).not.toHaveBeenCalled();
});
