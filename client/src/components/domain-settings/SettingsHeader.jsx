import React, { useEffect, useRef, useState } from 'react';
import './domain-list.css';
import { useMobileSettings } from './SettingsNavigation';

export default function SettingsHeader({ children, onDashboard, onAllWebsites, onAccount, onSettings, onManageDomains, onLogout }) {
  const [open, setOpen] = useState(false), profile = useRef(null), trigger = useRef(null);
  const mobile = useMobileSettings();
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!profile.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const action = handler => () => { setOpen(false); handler?.(); };
  return <header className="domain-list-header settings-shell-header"><div className="domain-list-header-inner">
    {children}
    <div className="domain-list-account">
      {!mobile && <button type="button" className="domain-list-dashboard-link" onClick={onDashboard}>Dashboard</button>}
      <div className="domain-list-profile" ref={profile}>
        <button ref={trigger} type="button" className="domain-list-profile-trigger" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M5 19c1-6 13-6 14 0" /></svg>
        </button>
        {open && <nav className="domain-list-profile-menu" aria-label="Account options">
          {mobile && <button type="button" onClick={action(onDashboard)}>Dashboard</button>}
          <a href="/dashboard" onClick={onAllWebsites ? event => { event.preventDefault(); action(onAllWebsites)(); } : undefined}>All websites</a>
          {onManageDomains && <button type="button" onClick={action(onManageDomains)}>Manage domains</button>}
          <a href="/settings/account" onClick={onAccount ? event => { event.preventDefault(); action(onAccount)(); } : undefined}>My account</a>
          {onSettings && <button type="button" onClick={action(onSettings)}>Settings</button>}
          <button type="button" onClick={action(onLogout)}>Log out</button>
        </nav>}
      </div>
    </div>
  </div></header>;
}
