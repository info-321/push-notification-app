import React, { useContext } from 'react';
import Icon from './DashboardIcon';
import SettingsHeader from '../domain-settings/SettingsHeader';
import { SettingsAccessContext, useMobileSettings } from '../domain-settings/SettingsNavigation';
import MobileFooter from '../navigation/MobileFooter';

export default function WebsiteHeader({ domains = [], domainKey, domainName, analytics = false, activePage = analytics ? 'analytics' : 'dashboard', onAllSites, onManageDomains, onSettings, onSelectDomain, onConfiguration = () => {}, onDashboard, onNavigate, onLogout }) {
  const mobile = useMobileSettings(), profile = useContext(SettingsAccessContext);
  if (mobile) {
    const dashboard = () => onDashboard ? onDashboard() : onSelectDomain?.(domainKey, domainName);
    const items = [
      { element: <button type="button" aria-label="Dashboard" onClick={dashboard} />, label: 'Dashboard', icon: <Icon name="home" />, current: activePage === 'dashboard' },
      ...(profile?.role === 'viewer' ? [] : [{ element: <a aria-label="Push" href={`/push?domain=${encodeURIComponent(domainKey)}`} target="_blank" rel="noopener noreferrer" title="Open Push Notification in a new tab" />, label: 'Push', icon: <Icon name="send" />, current: !['dashboard', 'reports'].includes(activePage) }]),
      { element: <a aria-label="Reports" href={`/push/reports?domain=${encodeURIComponent(domainKey)}`} onClick={onNavigate ? event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(event.currentTarget.getAttribute('href')); } : undefined} />, label: 'Reports', icon: <Icon name="report" />, current: activePage === 'reports' },
      ...(profile?.role === 'viewer' ? [] : [{ element: <button type="button" aria-label="Setup" onClick={() => onConfiguration(domainKey, domainName || '')} />, label: 'Setup', icon: <Icon name="settings" /> }]),
    ];
    return <>
      <SettingsHeader onDashboard={dashboard} onAllWebsites={onAllSites} onManageDomains={onManageDomains} onAccount={onNavigate ? () => onNavigate('/settings/account') : undefined} onSettings={onSettings} onLogout={onLogout}>
        <div className="domain-list-brand"><button type="button" className="domain-list-logo" onClick={onAllSites} aria-label="Back to all websites"><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
          <select aria-label="Website" value={domainKey} onChange={event => { const site=domains.find(item => item.domain_key === event.target.value); if (site) onSelectDomain?.(site.domain_key, site.domain_name); }}>
            {!domains.some(item => item.domain_key === domainKey) && <option value={domainKey}>{domainName || 'Selected website'}</option>}
            {domains.map(item => <option key={item.domain_key} value={item.domain_key}>{item.domain_name}</option>)}
          </select>
        </div>
      </SettingsHeader>
      <MobileFooter label="Website navigation" contentSelector=".overview-main" className="website-mobile-footer" items={items} />
    </>;
  }
  return <header className="overview-hero"><div className="overview-header-inner">
    <div className="overview-topbar">
      <div className="overview-brand"><button className="overview-logo" onClick={onAllSites} aria-label="Back to all websites"><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
        <label className="overview-domain-picker"><span className="overview-sr-only">Website</span><select aria-label="Website" value={domainKey} onChange={event => { const selected = domains.find(item => item.domain_key === event.target.value); if (selected) onSelectDomain?.(selected.domain_key, selected.domain_name); }}>
          {!domains.some(item => item.domain_key === domainKey) && <option value={domainKey}>{domainName || 'Selected website'}</option>}
          {domains.map(item => <option key={item.domain_key} value={item.domain_key}>{item.domain_name}</option>)}
        </select></label>
      </div>
      <div className="overview-account"><button onClick={onAllSites}>All websites</button><button onClick={onManageDomains}>Manage domains</button><button onClick={onSettings}>Settings</button><button onClick={onLogout}>Log out</button></div>
    </div>
    <nav className="overview-navigation" aria-label="Website navigation">
      <button className={activePage === 'dashboard' ? 'overview-nav-active' : ''} aria-current={activePage === 'dashboard' ? 'page' : undefined} onClick={onDashboard}><Icon name="home" />Dashboard</button>
      <a className={activePage === 'push' ? 'overview-nav-active' : ''} aria-current={activePage === 'push' ? 'page' : undefined} href={`/push?domain=${encodeURIComponent(domainKey)}`} target="_blank" rel="noopener noreferrer" title="Open Push Notification in a new tab"><Icon name="send" />Push Notification</a>
      <a className={activePage === 'reports' ? 'overview-nav-active' : ''} aria-current={activePage === 'reports' ? 'page' : undefined} href={`/push/reports?domain=${encodeURIComponent(domainKey)}`}><Icon name="report" />Reports</a>
      <button onClick={() => onConfiguration(domainKey, domainName || '')}><Icon name="settings" />Configuration</button>
    </nav>
  </div></header>;
}
