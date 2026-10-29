import React, { useEffect, useId, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import WebsiteHeader from './WebsiteHeader';
import AudienceMap from './AudienceMap';
import AudienceGeography from './AudienceGeography';
import SubscriberChart from './SubscriberChart';
import './dashboard.css';
import './analytics.css';

const number = value => new Intl.NumberFormat().format(value);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const formatDate = date => new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z')).replace(',', '');

export function presetRange(preset, today = todayUtc()) {
  const day = new Date(today + 'T00:00:00Z');
  if (preset === 'week') day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  if (preset === 'month') day.setUTCDate(1);
  return { start: day.toISOString().slice(0, 10), end: today };
}

function DateFilter({ label, range, onChange }) {
  const [selected, setSelected] = useState('month');
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState('');
  const id = useId();
  return <div className="analytics-date-filter" aria-label={label}>
    <div className="analytics-period-tabs" role="group" aria-label={label}>
      {[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom Dates']].map(([value, text]) => <button type="button" key={value} aria-pressed={selected === value} className={selected === value ? 'is-active' : ''} onClick={() => {
        setSelected(value); setError('');
        if (value !== 'custom') { const next = presetRange(value); setDraft(next); onChange(next); }
      }}>{text}</button>)}
    </div>
    {selected === 'custom' && <form className="analytics-custom-dates" onSubmit={event => {
      event.preventDefault();
      const days = (Date.parse(draft.end) - Date.parse(draft.start)) / 86400000;
      if (!Number.isFinite(days) || days < 0 || days >= 366 || draft.end > todayUtc()) { setError('Choose dates in order, up to today, spanning at most 366 days.'); return; }
      setError(''); onChange(draft);
    }}><label htmlFor={`${id}-from`}>From<input id={`${id}-from`} type="date" required min="1970-01-01" max={todayUtc()} value={draft.start} onChange={event => setDraft(current => ({ ...current, start: event.target.value }))} /></label><label htmlFor={`${id}-to`}>To<input id={`${id}-to`} type="date" required min={draft.start || '1970-01-01'} max={todayUtc()} value={draft.end} onChange={event => setDraft(current => ({ ...current, end: event.target.value }))} /></label><button type="submit">Apply dates</button></form>}
    {error && <p className="analytics-error" role="alert">{error}</p>}
  </div>;
}

function PeriodReport({ domainKey, refresh, browser = false }) {
  const [range, setRange] = useState(() => presetRange('month'));
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const heading = browser ? 'Audience Browser Analytic' : 'Subscribers';
  const id = useId();
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setReport(null); setError('');
    const query = new URLSearchParams(range);
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/analytics?${query}`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok || !Array.isArray(result.data?.daily)) throw new Error(result.message || 'Could not load analytics.');
      if (!cancelled) setReport(result.data);
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domainKey, refresh, range, retry]);

  return <section className="analytics-period-section" aria-labelledby={id}>
    <h2 id={id}>{heading}</h2>
    <DateFilter label={`${heading} date range`} range={range} onChange={setRange} />
    <div className={`overview-panel analytics-report-panel ${browser ? 'analytics-browser-panel' : 'analytics-subscribers-panel'}`}>
      <p className="analytics-range-label">{formatDate(range.start)} – {formatDate(range.end)} <span>UTC</span></p>
      {loading && <p className="analytics-note" role="status">Loading analytics...</p>}
      {error && <p className="analytics-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
      {report && !browser && <>
        <div className="analytics-chart-layout"><SubscriberChart key={`${range.start}-${range.end}`} daily={report.daily} devicesAvailable={report.device_available === true} /><table className="analytics-summary"><caption className="overview-sr-only">Subscriber period summary</caption><tbody>
          {[['Mobile', report.mobile], ['Desktop', report.desktop], ['App', report.app], ['Subscribers Added', report.added], ['Un-Subscribers', report.unsubscribed], ['Net Subscribers', report.net]].map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value === null ? <span aria-label="Not recorded" title="Not recorded">—</span> : number(value)}</td></tr>)}
        </tbody></table></div>
        {report.device_unknown > 0 && <p className="analytics-note analytics-device-note" role="note">Device type is unknown for {number(report.device_unknown)} {report.device_unknown === 1 ? 'subscription' : 'subscriptions'} in this period. Desktop and mobile counts include recorded devices only. Visit the website from those subscribed browsers, then refresh data.</p>}
        <p className="analytics-note">{report.basis}</p>
      </>}
      {report && browser && <div className="analytics-browser-empty"><p>Browser history has not been recorded.</p><p>No browser breakdown is available for this period.</p></div>}
    </div>
  </section>;
}

export default function Analytics({ domainKey, onAllSites, onManageDomains, onSettings, onSelectDomain, onConfiguration, onSendPush, onDashboard, onLogout }) {
  const [overview, setOverview] = useState(null);
  const [audience, setAudience] = useState(null);
  const [domains, setDomains] = useState([]);
  const [errors, setErrors] = useState({});
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setOverview(null); setAudience(null); setErrors({});
    const read = async suffix => {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/${suffix}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || `Could not load ${suffix}.`);
      return result.data;
    };
    Promise.allSettled([read('overview'), read('audience')]).then(([summary, geography]) => {
      if (cancelled) return;
      if (summary.status === 'fulfilled') setOverview(summary.value); else setErrors(current => ({ ...current, overview: summary.reason.message }));
      if (geography.status === 'fulfilled') setAudience(geography.value); else setErrors(current => ({ ...current, audience: geography.reason.message }));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [domainKey, refresh]);
  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/api/domains`).then(async response => { const result = await response.json(); if (!cancelled && response.ok && result.ok) setDomains(result.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const domain = overview?.domain, counts = overview?.subscribers;
  const openDashboard = () => onDashboard?.(domainKey, domain?.domain_name || '');
  return <div className="overview-page analytics-page">
    <WebsiteHeader analytics domains={domains} domainKey={domainKey} domainName={domain?.domain_name} onAllSites={onAllSites} onManageDomains={onManageDomains} onSettings={onSettings} onSelectDomain={onSelectDomain} onConfiguration={onConfiguration} onSendPush={onSendPush} onDashboard={openDashboard} onLogout={onLogout} />
    <main className="overview-main analytics-main">
      <nav className="analytics-navigation" aria-label="Push navigation"><button onClick={() => onSendPush?.(domainKey, domain?.domain_name || '')}>Send Push</button><button disabled title="Segments are not available yet">Segments</button><a href={`/dashboard?domain=${encodeURIComponent(domainKey)}#overview-reports`}>Reports</a><button disabled title="Scheduling is not available yet">Schedule List</button><button disabled title="Templates are not available yet">Template Gallery</button><button onClick={() => onConfiguration?.(domainKey, domain?.domain_name || '')}>Push Setting</button><span aria-current="page">Analytics</span></nav>
      <div className="analytics-heading"><h1>{domain?.display_name || domain?.domain_name || 'Website'} Analytics</h1><button className="overview-refresh" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? 'Refreshing...' : 'Refresh data'}</button></div>
      {loading && <p className="analytics-note" role="status">Loading website analytics...</p>}
      {Object.entries(errors).map(([key, message]) => <p key={key} className="analytics-error" role="alert">{message} <button onClick={() => setRefresh(value => value + 1)}>Try again</button></p>)}
      {counts && <section className="overview-metrics" aria-label="Subscriber statistics">{[['Total Subscribers', counts.total], ['Web Subscribers', counts.web], ['Mobile Subscribers', counts.mobile], ['App Subscribers', counts.app]].map(([label, value]) => <article className="overview-panel overview-metric" key={label}><strong aria-label={`${label}: ${value === null ? 'Not available' : value}`}>{value === null ? '—' : number(value)}</strong><h2>{label}</h2>{value === null && <p>Not recorded</p>}</article>)}</section>}
      <AudienceGeography key={domainKey} audience={audience} loading={loading} />
      {audience && <div className="analytics-map"><AudienceMap domainKey={domainKey} data={audience} showHeading={false} /></div>}
      <PeriodReport key={`${domainKey}-subscribers`} domainKey={domainKey} refresh={refresh} />
      <PeriodReport key={`${domainKey}-browser`} domainKey={domainKey} refresh={refresh} browser />
    </main>
  </div>;
}
