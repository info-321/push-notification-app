import React, { createContext, forwardRef, useContext, useEffect, useState } from 'react';
import MobileFooter from '../navigation/MobileFooter';
import './settings-navigation.css';

export const SettingsAccessContext = createContext(null);

export function useMobileSettings() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 620px)').matches || false);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 620px)');
    if (!query) return;
    const update = () => setMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

const mobileLabel = label => ({ Domain: 'Domains', User: 'Users', Configuration: 'Setup', 'PWA Setting': 'PWA Settings' }[label] || label);

function NavigationIcon({ section }) {
  const paths = {
    Settings: <><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
    Account: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    Setup: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></>,
    Domains: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>,
    Users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[section]}</svg>;
}

const SettingsNavigation = forwardRef(function SettingsNavigation({ children }, ref) {
  const profile = useContext(SettingsAccessContext), mobile = useMobileSettings();
  const items = React.Children.toArray(children).filter(item => {
    if (!React.isValidElement(item)) return false;
    const permission = item.props['data-access'] || ({ User: 'users', Configuration: 'configure' }[item.props.children]);
    if (permission === 'users' && profile && !['admin', 'superadmin'].includes(profile.role)) return false;
    return !(permission === 'configure' && profile?.role === 'viewer');
  });
  const active = items.find(item => item.props['aria-current'] === 'page');

  if (!mobile) return <nav ref={ref} className="domain-list-tabs" aria-label="Settings navigation">{items}</nav>;
  const setup = items.find(item => item.props.children === 'Configuration') || items.find(item => item.props.children === 'PWA Setting');
  const bottomItems = items.filter(item => item === setup || !['Configuration', 'PWA Setting'].includes(item.props.children));
  const inAdvanced = active?.props.children === 'PWA Setting';
  return <>
    <div className="settings-mobile-heading">
      <p>{inAdvanced ? 'Setup / Advanced' : 'Website settings'}</p>
      <h1>{mobileLabel(active?.props.children || 'Settings')}</h1>
      {inAdvanced && setup?.props.children === 'Configuration' && React.cloneElement(setup, {
        className: 'settings-back-setup',
        children: <><span aria-hidden="true">&#8592;</span> Back to Setup</>,
      })}
    </div>
    <MobileFooter label="Settings navigation" contentSelector=".domain-list-main" items={bottomItems.map(item => {
        const label = item === setup ? 'Setup' : mobileLabel(item.props.children);
        const current = item === active || (item === setup && inAdvanced);
        return { element: item, label, icon: <NavigationIcon section={label} />, current, ariaCurrent: inAdvanced ? 'location' : 'page' };
      })} />
  </>;
});
export default SettingsNavigation;
