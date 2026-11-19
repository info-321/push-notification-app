import React, { createContext, forwardRef, useContext, useEffect, useId, useRef, useState } from 'react';
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

const mobileLabel = label => ({ Domain: 'Domains', User: 'Users', 'PWA Setting': 'PWA Settings' }[label] || label);

const SettingsNavigation = forwardRef(function SettingsNavigation({ children }, ref) {
  const profile = useContext(SettingsAccessContext), mobile = useMobileSettings();
  const [open, setOpen] = useState(false);
  const dialog = useRef(null), trigger = useRef(null), heading = useId();
  const items = React.Children.toArray(children).filter(item => {
    if (!React.isValidElement(item)) return false;
    const permission = item.props['data-access'] || ({ User: 'users', Configuration: 'configure' }[item.props.children]);
    if (permission === 'users' && profile && !['admin', 'superadmin'].includes(profile.role)) return false;
    return !(permission === 'configure' && profile?.role === 'viewer');
  });
  const active = items.find(item => item.props['aria-current'] === 'page');

  useEffect(() => {
    if (!open || !mobile) return;
    const panel = dialog.current, opener = trigger.current, previousOverflow = document.body.style.overflow;
    panel.showModal(); document.body.style.overflow = 'hidden';
    (panel.querySelector('[aria-current="page"]') || panel.querySelector('button'))?.focus();
    return () => {
      if (panel.open) panel.close();
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open, mobile]);
  useEffect(() => { if (!mobile) setOpen(false); }, [mobile]);

  if (!mobile) return <nav ref={ref} className="domain-list-tabs" aria-label="Settings navigation">{items}</nav>;
  return <nav className="settings-mobile-navigation" aria-label="Settings navigation">
    <span className="settings-mobile-caption">Website settings</span>
    <button ref={trigger} type="button" className="settings-section-trigger" aria-label={`Choose settings section: ${mobileLabel(active?.props.children || 'Settings')}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span>{mobileLabel(active?.props.children || 'Settings')}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <dialog ref={dialog} className="settings-section-sheet" aria-labelledby={heading} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) setOpen(false); } }}>
      <div className="settings-sheet-handle" aria-hidden="true" />
      <div className="settings-sheet-heading"><h2 id={heading}>Website settings</h2><button type="button" aria-label="Close settings navigation" onClick={() => setOpen(false)}>×</button></div>
      <div className="settings-section-options">{items.map(item => React.cloneElement(item, {
        className: item.props['aria-current'] ? 'settings-section-current' : '',
        onClick: event => { setOpen(false); item.props.onClick?.(event); },
        children: <><span>{mobileLabel(item.props.children)}</span>{item.props['aria-current'] === 'page' && <span aria-hidden="true">✓</span>}</>,
      }))}</div>
    </dialog>}
  </nav>;
});
export default SettingsNavigation;
