import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import SettingsNavigation, { SettingsAccessContext } from './SettingsNavigation';
import SettingsHeader from './SettingsHeader';

let query, listeners;
beforeEach(() => {
  listeners = new Set();
  query = { matches:true, addEventListener:(_,listener)=>listeners.add(listener), removeEventListener:(_,listener)=>listeners.delete(listener) };
  window.matchMedia = jest.fn(() => query);
  window.scrollTo = jest.fn();
});
afterEach(() => { delete window.matchMedia; document.body.style.overflow = ''; });

function Navigation({ role = 'admin', navigate = jest.fn(), setup = jest.fn(), pwa = jest.fn(), active = 'Account', disabledSetup = false }) {
  return <SettingsAccessContext.Provider value={{role}}><SettingsNavigation>
    <button aria-current={active==='Settings'?'page':undefined} onClick={navigate}>Settings</button><button aria-current={active==='Account'?'page':undefined}>Account</button>
    <button disabled={disabledSetup} aria-current={active==='Configuration'?'page':undefined} onClick={setup}>Configuration</button><button>Domain</button><button aria-current={active==='PWA Setting'?'page':undefined} onClick={pwa}>PWA Setting</button><button>User</button>
  </SettingsNavigation></SettingsAccessContext.Provider>;
}

test('mobile settings provide five direct destinations with the selected page and working navigation', () => {
  const navigate=jest.fn(); render(<Navigation navigate={navigate}/>);
  const nav=screen.getByRole('navigation',{name:'Settings navigation'});
  expect(within(nav).getAllByRole('button').map(button=>button.textContent)).toEqual(['Settings','Account','Setup','Domains','Users']);
  expect(within(nav).getByRole('button',{name:'Account'}).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('button',{name:/Choose settings section/})).toBeNull();
  fireEvent.click(within(nav).getByRole('button',{name:'Settings',exact:true}));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(window.scrollTo).toHaveBeenCalledWith({top:0,behavior:'auto'});
});

test('PWA settings remain inside Setup, with a return link and desktop tab access', () => {
  const setup=jest.fn(); render(<Navigation active="PWA Setting" setup={setup}/>);
  const nav=screen.getByRole('navigation',{name:'Settings navigation'});
  expect(within(nav).getByRole('button',{name:'Setup'}).getAttribute('aria-current')).toBe('location');
  expect(within(nav).queryByRole('button',{name:'PWA Settings'})).toBeNull();
  expect(screen.getByRole('heading',{name:'PWA Settings'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Back to Setup'}));
  expect(setup).toHaveBeenCalledTimes(1);
  act(()=>{query.matches=false;listeners.forEach(listener=>listener());});
  expect(screen.getByRole('navigation',{name:'Settings navigation'}).className).toBe('domain-list-tabs');
  expect(screen.getByRole('button',{name:'PWA Setting'}).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('button',{name:'Setup'})).toBeNull();
});

test('viewer navigation excludes user management and routes Setup to the permitted PWA page', () => {
  const setup=jest.fn(),pwa=jest.fn(); render(<Navigation role="viewer" setup={setup} pwa={pwa}/>);
  const nav=screen.getByRole('navigation',{name:'Settings navigation'});
  expect(within(nav).queryByRole('button',{name:'Users'})).toBeNull();
  expect(within(nav).queryByRole('button',{name:'Configuration'})).toBeNull();
  fireEvent.click(within(nav).getByRole('button',{name:'Setup'}));
  expect(pwa).toHaveBeenCalledTimes(1);expect(setup).not.toHaveBeenCalled();
});

test('disabled setup controls do not navigate, and editor navigation hides user management', () => {
  const setup=jest.fn();render(<Navigation role="editor" disabledSetup setup={setup}/>);
  const nav=screen.getByRole('navigation',{name:'Settings navigation'});
  expect(within(nav).getByRole('button',{name:'Setup'}).disabled).toBe(true);
  fireEvent.click(within(nav).getByRole('button',{name:'Setup'}));
  expect(setup).not.toHaveBeenCalled();
  expect(within(nav).queryByRole('button',{name:'Users'})).toBeNull();
});

test('the mobile footer is outside the scrolling content and resets the content position', () => {
  const view=render(<main className="domain-list-main"><Navigation/></main>);
  const pane=screen.getByRole('main'),scroll=jest.fn();pane.scrollTo=scroll;
  const nav=screen.getByRole('navigation',{name:'Settings navigation'});
  expect(pane.contains(nav)).toBe(false);
  fireEvent.click(within(nav).getByRole('button',{name:'Account',exact:true}));
  expect(scroll).toHaveBeenCalledWith({top:0,behavior:'auto'});
  act(()=>{query.matches=false;listeners.forEach(listener=>listener());});
  expect(pane.contains(screen.getByRole('navigation',{name:'Settings navigation'}))).toBe(true);
  expect(document.querySelector('.settings-mobile-footer')).toBeNull();
  view.unmount();
  expect(document.querySelector('.settings-mobile-footer')).toBeNull();
});

test('the mobile account menu keeps Dashboard accessible and has no extra arrow', () => {
  const dashboard=jest.fn(),logout=jest.fn();
  render(<SettingsHeader onDashboard={dashboard} onLogout={logout}><div className="domain-list-brand">Website</div></SettingsHeader>);
  expect(screen.queryByRole('button',{name:'Dashboard'})).toBeNull();
  const account=screen.getByRole('button',{name:'Account menu'});
  expect(account.textContent).toBe(''); fireEvent.click(account);
  expect(screen.getByRole('link',{name:'All websites'}).getAttribute('href')).toBe('/dashboard');
  expect(screen.getByRole('link',{name:'My account'}).getAttribute('href')).toBe('/settings/account');
  fireEvent.click(screen.getByRole('button',{name:'Dashboard'}));expect(dashboard).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('navigation',{name:'Account options'})).toBeNull();
  fireEvent.click(account);fireEvent.keyDown(document,{key:'Escape'});
  expect(account.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(account);
});

test.each(['superadmin','admin','editor','viewer'])('account menu gates platform administration for %s on mobile and desktop', role => {
  render(<SettingsAccessContext.Provider value={{role}}><SettingsHeader /></SettingsAccessContext.Provider>);
  fireEvent.click(screen.getByRole('button',{name:'Account menu'}));
  for (const mobile of [true,false]) {
    act(()=>{query.matches=mobile;listeners.forEach(listener=>listener());});
    const link=screen.queryByRole('link',{name:'Platform Administration'});
    if(role==='superadmin') expect(link.getAttribute('href')).toBe('/platform');
    else expect(link).toBeNull();
  }
});
