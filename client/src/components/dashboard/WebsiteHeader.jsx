import React from 'react';
import Icon from './DashboardIcon';

export default function WebsiteHeader({ domains = [], domainKey, domainName, analytics = false, onAllSites, onManageDomains, onSettings, onSelectDomain, onConfiguration = () => {}, onSendPush = () => {}, onDashboard, onLogout }) {
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
      <button className={analytics ? '' : 'overview-nav-active'} aria-current={analytics ? undefined : 'page'} onClick={onDashboard}><Icon name="home" />Dashboard</button>
      <button onClick={() => onSendPush(domainKey, domainName || '')}><Icon name="send" />Push Notification</button>
      <a href={analytics ? `/dashboard?domain=${encodeURIComponent(domainKey)}#overview-reports` : '#overview-reports'}><Icon name="report" />Reports</a>
      <button disabled title="Newsroll is not available yet">Newsroll <span>Coming soon</span></button><button disabled title="Newsbox is not available yet">Newsbox <span>Coming soon</span></button>
      <button onClick={() => onConfiguration(domainKey, domainName || '')}><Icon name="settings" />Configuration</button>
    </nav>
  </div></header>;
}
