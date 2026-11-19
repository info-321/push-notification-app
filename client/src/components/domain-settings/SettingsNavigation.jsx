import React, { createContext, forwardRef, useContext, useEffect, useState } from 'react';
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
    <div className="settings-mobile-footer">
      <div className="settings-content-edge" aria-hidden="true" />
      <nav className="settings-bottom-navigation" aria-label="Settings navigation">
      {bottomItems.map(item => {
        const label = item === setup ? 'Setup' : mobileLabel(item.props.children);
        const current = item === active || (item === setup && inAdvanced);
        return React.cloneElement(item, {
          className: current ? 'settings-bottom-item is-current' : 'settings-bottom-item',
          'aria-label': label,
          title: label,
          'aria-current': current ? (inAdvanced ? 'location' : 'page') : undefined,
          onClick: event => {
            if (item.props.disabled || item.props['aria-disabled']) { event.preventDefault(); return; }
            item.props.onClick?.(event);
            if (!event.defaultPrevented) window.scrollTo({ top: 0, behavior: 'auto' });
          },
          children: <><NavigationIcon section={label} /><span className="settings-bottom-label">{label}</span></>,
        });
      })}
      </nav>
    </div>
  </>;
});
export default SettingsNavigation;
