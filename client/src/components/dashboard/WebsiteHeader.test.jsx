import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import WebsiteHeader from './WebsiteHeader';
import { SettingsAccessContext } from '../domain-settings/SettingsNavigation';

let query,listeners;
const domains=[{domain_key:'ttw',domain_name:'travelandtourworld.com'},{domain_key:'mice',domain_name:'micetraveladvisor.com'}];
beforeEach(()=>{
  listeners=new Set();query={matches:true,addEventListener:(_,callback)=>listeners.add(callback),removeEventListener:(_,callback)=>listeners.delete(callback)};
  window.matchMedia=jest.fn(()=>query);window.scrollTo=jest.fn();
});
afterEach(()=>{delete window.matchMedia;});
const Header=({role='admin',...props})=><SettingsAccessContext.Provider value={{role}}><WebsiteHeader mobileDashboard domains={domains} domainKey="ttw" domainName="travelandtourworld.com" {...props}/></SettingsAccessContext.Provider>;

test('mobile dashboard has four destinations, correct website links and working Setup navigation',()=>{
  const configure=jest.fn();render(<Header onConfiguration={configure}/>);
  const nav=screen.getByRole('navigation',{name:'Website navigation'});
  expect(within(nav).getByRole('button',{name:'Dashboard'}).getAttribute('aria-current')).toBe('page');
  const push=within(nav).getByRole('link',{name:'Push'});
  expect(push.getAttribute('href')).toBe('/push?domain=ttw');expect(push.getAttribute('target')).toBe('_blank');
  expect(within(nav).getByRole('link',{name:'Reports'}).getAttribute('href')).toBe('/push/reports?domain=ttw');
  fireEvent.click(within(nav).getByRole('button',{name:'Setup'}));expect(configure).toHaveBeenCalledWith('ttw','travelandtourworld.com');
});

test('compact account menu includes management links and closes after navigation',()=>{
  const manage=jest.fn(),settings=jest.fn();render(<Header onManageDomains={manage} onSettings={settings}/>);
  expect(screen.queryByRole('button',{name:'All websites',exact:true})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Account menu'}));
  const menu=screen.getByRole('navigation',{name:'Account options'});
  expect(within(menu).getByRole('link',{name:'My account'}).getAttribute('href')).toBe('/settings/account');
  fireEvent.click(within(menu).getByRole('button',{name:'Manage domains'}));expect(manage).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('navigation',{name:'Account options'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Account menu'}));fireEvent.click(screen.getByRole('button',{name:'Settings',exact:true}));expect(settings).toHaveBeenCalledTimes(1);
});

test('website picker changes the selected website and desktop navigation returns after resizing',()=>{
  const select=jest.fn();render(<Header onSelectDomain={select}/>);
  fireEvent.change(screen.getByRole('combobox',{name:'Website'}),{target:{value:'mice'}});
  expect(select).toHaveBeenCalledWith('mice','micetraveladvisor.com');
  act(()=>{query.matches=false;listeners.forEach(callback=>callback());});
  expect(document.querySelector('.website-mobile-footer')).toBeNull();
  expect(screen.getByRole('link',{name:'Push Notification'}).getAttribute('target')).toBe('_blank');
  expect(screen.getByRole('button',{name:'All websites',exact:true})).toBeTruthy();
});

test('viewers have read-only dashboard navigation',()=>{
  render(<Header role="viewer"/>);const nav=screen.getByRole('navigation',{name:'Website navigation'});
  expect(within(nav).getByRole('button',{name:'Dashboard'})).toBeTruthy();expect(within(nav).getByRole('link',{name:'Reports'})).toBeTruthy();
  expect(within(nav).queryByRole('link',{name:'Push'})).toBeNull();expect(within(nav).queryByRole('button',{name:'Setup'})).toBeNull();
});
