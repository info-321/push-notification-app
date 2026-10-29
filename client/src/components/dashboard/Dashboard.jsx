import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './dashboard.css';
import AudienceMap from './AudienceMap';

function Icon({ name, ...props }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v11H3Z" /><path d="M9 21v-8h6v8" /></>,
    send: <><path d="m21 3-7 18-4-7-7-4Z" /><path d="m10 14 5-5" /></>,
    template: <><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M8 21h13V8M7 10h6m-3-3v6" /></>,
    report: <><path d="M6 3h12v18H6Z" /><path d="M9 8h6m-6 4h6m-6 4h4" /></>,
    bell: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4" /><path d="M12 2v2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
    popup: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18m-13 6h8" /></>,
    exit: <><path d="M14 3h6v18h-6M3 12h12m-7-5-5 5 5 5" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.report}</svg>;
}

const number = value => new Intl.NumberFormat().format(value);

export default function Dashboard({ domainKey, onAllSites, onManageDomains, onSettings, onSelectDomain, onConfiguration, onSendPush, onLogout }) {
  const [overview, setOverview] = useState(null);
  const [domains, setDomains] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setOverview(null);
    setError('');
    async function load() {
      try {
        const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/overview`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load the dashboard.');
        if (!cancelled) setOverview(result.data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load the dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [domainKey, refresh]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/api/domains`).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (!cancelled && result.ok) setDomains(result.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const domain = overview?.domain;
  const counts = overview?.subscribers;
  const openConfig = () => onConfiguration(domainKey, domain?.domain_name || '');
  const sendPush = () => onSendPush(domainKey, domain?.domain_name || '');

  return (
    <div className="overview-page">
      <header className="overview-hero">
        <div className="overview-header-inner">
          <div className="overview-topbar">
            <div className="overview-brand">
              <button className="overview-logo" onClick={onAllSites} aria-label="Back to all websites"><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
              <label className="overview-domain-picker"><span className="overview-sr-only">Website</span>
                <select value={domainKey} onChange={event => {
                  const selected = domains.find(item => item.domain_key === event.target.value);
                  if (selected) onSelectDomain(selected.domain_key, selected.domain_name);
                }}>
                  {!domains.some(item => item.domain_key === domainKey) && <option value={domainKey}>{domain?.domain_name || 'Selected website'}</option>}
                  {domains.map(item => <option key={item.domain_key} value={item.domain_key}>{item.domain_name}</option>)}
                </select>
              </label>
            </div>
            <div className="overview-account"><button onClick={onAllSites}>All websites</button><button onClick={onManageDomains}>Manage domains</button><button onClick={onSettings}>Settings</button><button onClick={onLogout}>Log out</button></div>
          </div>
          <nav className="overview-navigation" aria-label="Website navigation">
            <button className="overview-nav-active" aria-current="page"><Icon name="home" />Dashboard</button>
            <button onClick={sendPush}><Icon name="send" />Push Notification</button>
            <a href="#overview-reports"><Icon name="report" />Reports</a>
            <button disabled title="Newsroll is not available yet">Newsroll <span>Coming soon</span></button>
            <button disabled title="Newsbox is not available yet">Newsbox <span>Coming soon</span></button>
            <button onClick={openConfig}><Icon name="settings" />Configuration</button>
          </nav>
        </div>
      </header>

      <main className="overview-main">
        <div className="overview-heading">
          <div><p className="overview-eyebrow">WEBSITE OVERVIEW</p><h1>{domain?.domain_name || 'Dashboard'}</h1></div>
          <button className="overview-refresh" onClick={() => setRefresh(value => value + 1)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh data'}</button>
        </div>
        {loading && <div className="overview-panel overview-message" role="status">Loading your dashboard…</div>}
        {error && <div className="overview-panel overview-message" role="alert"><p>{error}</p><button onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
        {!loading && !error && overview && <>
          <div className={`overview-setup ${domain.is_configured ? 'is-connected' : ''}`}>
            <span><span className="overview-status-dot" />{domain.is_configured ? 'Configured · Browser subscriptions are connected' : 'Setup needed · Enable notifications on your website to connect a browser'}</span>
            <button onClick={openConfig}>Manage configuration <span aria-hidden="true">→</span></button>
          </div>
          <section className="overview-metrics" aria-label="Subscriber statistics">
            {[
              ['Total Subscribers', counts.total, 'Current saved subscriptions'],
              ['Web Subscribers', counts.web, 'Desktop and mobile browsers'],
              ['Mobile Subscribers', counts.mobile, 'Device breakdown not tracked'],
              ['App Subscribers', counts.app, 'Native app integration not enabled'],
            ].map(([label, value, detail]) => <article className="overview-panel overview-metric" key={label}>
              <strong aria-label={`${label}: ${value === null ? 'Not available' : value}`}>{value === null ? '—' : number(value)}</strong><h2>{label}</h2><p>{detail}</p>
            </article>)}
          </section>
          <p className="overview-data-note">Counts represent browser subscriptions, not unique people. Last refreshed {new Date(overview.updated_at).toLocaleString(undefined, { timeZone: domain.time_zone || undefined })}{domain.time_zone ? ` (${domain.time_zone})` : ''}.</p>

          <div className="overview-middle">
            <section aria-labelledby="overview-quick-links"><h2 className="overview-section-title" id="overview-quick-links">Quick Links</h2>
              <div className="overview-quick-grid">
                <button className="overview-panel overview-quick" onClick={sendPush}><Icon name="send" /><span>Send Push<small>Create a notification</small></span><span className="overview-quick-arrow" aria-hidden="true">↗</span></button>
                <button className="overview-panel overview-quick" onClick={openConfig}><Icon name="settings" /><span>Configuration<small>Manage WordPress setup</small></span><span className="overview-quick-arrow" aria-hidden="true">↗</span></button>
                <button className="overview-panel overview-quick" disabled><Icon name="template" /><span>Add Push Templates<small>Coming soon</small></span></button>
                <a className="overview-panel overview-quick" href="#overview-reports"><Icon name="report" /><span>Push Reports<small>Reporting status</small></span><span className="overview-quick-arrow" aria-hidden="true">↗</span></a>
              </div>
            </section>
            <AudienceMap key={domainKey} domainKey={domainKey} refresh={refresh} />
          </div>

          <section id="overview-reports" aria-labelledby="overview-reports-heading">
            <h2 className="overview-section-title" id="overview-reports-heading">Reports</h2>
            <div className="overview-panel overview-reports">
              <div className="overview-report-tab">Push</div>
              <div className="overview-table-scroll"><table><thead><tr>{['Sent', 'Title', 'Subscribers', 'Accepted by push services', 'Clicks', 'Click rate'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead></table></div>
              <div className="overview-report-empty"><Icon name="report" /><h3>Campaign reporting is not enabled yet</h3><p>Past test notifications were not saved as campaigns. Send results appear in the notification form; delivery and clicks are not tracked.</p><button onClick={sendPush}>Send a notification</button></div>
            </div>
          </section>

          <section aria-labelledby="overview-events"><h2 className="overview-section-title" id="overview-events">Events</h2>
            <div className="overview-events">
              <button className="overview-panel overview-event" onClick={sendPush}><Icon name="bell" /><span>Notifications</span><small>Open composer <span aria-hidden="true">→</span></small></button>
              {[
                ['Offer Popup', 'popup'], ['Exit Offer', 'exit'], ['Newsletter', 'mail'], ['Miscellaneous', 'template'], ['Survey', 'report'],
              ].map(([label, icon]) => <div className="overview-panel overview-event overview-unavailable" key={label}><Icon name={icon} /><span>{label}</span><small>Not enabled</small></div>)}
            </div>
          </section>
        </>}
      </main>
    </div>
  );
}
