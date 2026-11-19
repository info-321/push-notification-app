import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import SettingsNavigation, { SettingsAccessContext } from './SettingsNavigation';
import SettingsHeader from './SettingsHeader';

let query, listeners;
beforeEach(() => {
  listeners = new Set();
  query = { matches:true, addEventListener:(_,listener)=>listeners.add(listener), removeEventListener:(_,listener)=>listeners.delete(listener) };
  window.matchMedia = jest.fn(() => query);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { delete window.matchMedia; document.body.style.overflow = ''; });

function Navigation({ role = 'admin', navigate = jest.fn() }) {
  return <SettingsAccessContext.Provider value={{role}}><SettingsNavigation>
    <button onClick={navigate}>Settings</button><button aria-current="page">Account</button>
    <button disabled>Configuration</button><button>Domain</button><button>PWA Setting</button><button>User</button>
  </SettingsNavigation></SettingsAccessContext.Provider>;
}

test('mobile navigation opens the current section, navigates, and restores scroll and focus', () => {
  const navigate=jest.fn(); render(<Navigation navigate={navigate}/>);
  const trigger=screen.getByRole('button',{name:'Choose settings section: Account'});
  fireEvent.click(trigger);
  const sheet=screen.getByRole('dialog',{name:'Website settings'});
  expect(within(sheet).getByRole('button',{name:'Account'}).getAttribute('aria-current')).toBe('page');
  expect(document.activeElement).toBe(within(sheet).getByRole('button',{name:'Account'}));
  expect(within(sheet).getByRole('button',{name:'Configuration'}).disabled).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(within(sheet).getByRole('button',{name:'Settings',exact:true}));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(trigger);
});

test('native Escape dismissal and resizing close the sheet cleanly', () => {
  render(<Navigation/>);
  const trigger=screen.getByRole('button',{name:'Choose settings section: Account'});
  fireEvent.click(trigger); fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true}));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  act(()=>{query.matches=false;listeners.forEach(listener=>listener());});
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(screen.getByRole('navigation',{name:'Settings navigation'}).className).toBe('domain-list-tabs');
});

test('role restrictions hide user management and configuration from a viewer', () => {
  render(<Navigation role="viewer"/>);
  fireEvent.click(screen.getByRole('button',{name:'Choose settings section: Account'}));
  const sheet=screen.getByRole('dialog');
  expect(within(sheet).queryByRole('button',{name:'Users'})).toBeNull();
  expect(within(sheet).queryByRole('button',{name:'Configuration'})).toBeNull();
  expect(within(sheet).getByRole('button',{name:'Domains'})).toBeTruthy();
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
