import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PushNavigation from './PushNavigation';
import { SettingsAccessContext } from '../domain-settings/SettingsNavigation';

let mobile;
beforeEach(()=>{mobile=true;window.matchMedia=()=>({matches:mobile,addEventListener:()=>{},removeEventListener:()=>{}});});
afterEach(()=>{delete window.matchMedia;});
const Sections=({role='admin',onNavigate,onSend})=><SettingsAccessContext.Provider value={{role}}><PushNavigation onNavigate={onNavigate}>
  <button onClick={onSend}>Send Push</button><button disabled>Segments</button><span aria-current="page">Reports</span><a href="/push/schedules?domain=ttw">Schedule List</a><button disabled>Template Gallery</button><a href="/push/settings?domain=ttw">Push Setting</a><a href="/analytics?domain=ttw">Analytics</a>
</PushNavigation></SettingsAccessContext.Provider>;

test('mobile selector shows the current section and preserves destination and callback navigation',()=>{
  const navigate=jest.fn(),send=jest.fn();render(<Sections onNavigate={navigate} onSend={send}/>);
  const select=screen.getByRole('combobox',{name:'Push section'});
  expect(select).toHaveDisplayValue('Reports');
  expect(screen.getByRole('option',{name:'Segments (coming soon)'})).toBeDisabled();
  fireEvent.change(select,{target:{value:'3'}});expect(navigate).toHaveBeenCalledWith('/push/schedules?domain=ttw');
  fireEvent.change(select,{target:{value:'0'}});expect(send).toHaveBeenCalledTimes(1);
  navigate.mockClear();fireEvent.change(select,{target:{value:'1'}});fireEvent.change(select,{target:{value:'2'}});expect(navigate).not.toHaveBeenCalled();
});
test('viewer mobile sections only offer Reports and Analytics',()=>{
  render(<Sections role="viewer"/>);expect(screen.getAllByRole('option').map(option=>option.textContent)).toEqual(['Reports','Analytics']);
});
test('desktop retains the full navigation row and original links',()=>{
  mobile=false;render(<Sections/>);expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Schedule List'})).toHaveAttribute('href','/push/schedules?domain=ttw');
  expect(screen.getByRole('button',{name:'Send Push'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Segments Coming soon'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Template Gallery Coming soon'})).toBeDisabled();
});
