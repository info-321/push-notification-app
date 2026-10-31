import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import WebsiteHeader from './WebsiteHeader';
import './dashboard.css';
import './analytics.css';
import './reports.css';

const number = value => value == null ? 'Not tracked' : new Intl.NumberFormat().format(value);
const date = (value, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const states = { sending: 'Sending', completed: 'Completed', partial: 'Partially accepted', failed: 'Failed', interrupted: 'Interrupted — review results' };
export function ReportTable({ rows, domainKey, timeZone, compact = false }) {
  return <div className={`report-table-scroll ${compact ? 'report-compact' : ''}`}><table><caption className="overview-sr-only">Push campaign reports</caption><thead><tr><th>Sent</th><th>{compact ? 'Title' : 'Campaign'}</th><th>Targeted subscribers</th>{!compact && <th>Audience</th>}<th>Accepted</th>{!compact && <th title="Successful notification-creation acknowledgements from updated browsers">Browser reports</th>}<th>Unique clicks</th><th>Click rate</th>{!compact && <><th>Result</th><th>Action</th></>}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}><td>{date(row.sent_at, timeZone)}{row.is_test && <small className="report-test">Test notification</small>}</td><td>{compact ? <span className="report-title" title={row.content.title}>{row.content.title}</span> : <div className="report-preview">{row.content.icon ? <img src={row.content.icon} alt="Notification icon" loading="lazy" /> : <span aria-hidden="true">🔔</span>}<div><strong>{row.content.title}</strong><p>{row.content.body}</p><small>{row.source === 'historical' ? 'Historical schedule result' : row.source}</small></div></div>}</td><td>{number(row.targeted)}</td>{!compact && <td>{row.content.audience?.platform || 'all'}<small>Subscribed: {row.content.audience?.subscribed || 'all'}</small></td>}<td>{number(row.accepted)}</td>{!compact && <td>{number(row.acknowledged)}</td>}<td>{number(row.clicks)}</td><td>{row.click_rate == null ? 'Not available' : `${row.click_rate.toFixed(2)}%`}</td>{!compact && <><td><strong className={`report-status ${row.status}`}>{states[row.status] || row.status}</strong><small>Failed: {number(row.failed)}</small><small>Expired: {number(row.expired)}</small></td><td><a className="report-copy" href={`/push?domain=${encodeURIComponent(domainKey)}&copy=${encodeURIComponent(row.id)}`} target="_blank" rel="noopener noreferrer">Copy to draft</a></td></>}</tr>)}{!rows.length && <tr><td colSpan={compact ? 6 : 10} className="report-empty">No campaign reports match these filters. New sends will appear here; earlier unsaved sends cannot be recovered.</td></tr>}</tbody></table></div>;
}
export function ReportsSummary({ domainKey, timeZone, refresh }) {
  const [rows, setRows] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setError(''); setRows(null);
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/reports?limit=5&tests=hide`).then(async response => {
      const result = await response.json(); if (!response.ok || !result.ok || !Array.isArray(result.data?.rows)) throw new Error('Could not load recent reports.');
      if (!cancelled) setRows(result.data.rows);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, refresh]);
  return <section id="overview-reports" aria-labelledby="overview-reports-heading"><div className="report-heading"><h2 className="overview-section-title" id="overview-reports-heading">Reports</h2><a href={`/push/reports?domain=${encodeURIComponent(domainKey)}`}>View All</a></div><div className="overview-panel overview-reports"><div className="overview-report-tab">Push</div>{error ? <p role="alert" className="report-note">{error} <a href={`/push/reports?domain=${encodeURIComponent(domainKey)}`}>Open Reports to retry</a></p> : rows ? <ReportTable rows={rows} domainKey={domainKey} timeZone={timeZone} compact /> : <p role="status" className="report-note">Loading recent reports...</p>}</div></section>;
}

export default function Reports({ domainKey, onAllSites, onManageDomains, onSettings, onSelectDomain, onDashboard, onConfiguration, onLogout }) {
  const [domains, setDomains] = useState([]), [data, setData] = useState(null), [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', from: '', to: '', status: 'all', tests: 'hide' }), [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [exporting, setExporting] = useState(false);
  const domain = domains.find(site => site.domain_key === domainKey), query = new URLSearchParams(applied).toString();
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    Promise.all([apiFetch(`${API_BASE}/api/domains`), apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/reports?${query}&page=${page}`)]).then(async responses => {
      const [sites, reports] = await Promise.all(responses.map(response => response.json()));
      if (responses.some(response => !response.ok) || !sites.ok || !reports.ok || !Array.isArray(reports.data?.rows)) throw new Error(reports.message || 'Could not load campaign reports.');
      if (!cancelled) { setDomains(sites.data); setData(reports.data); }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, query, page, refresh]);
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const download = async () => {
    setExporting(true); setError('');
    try {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/reports/export?${query}`);
      if (!response.ok) throw new Error('Could not download reports. Please try again.');
      const href = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = href; link.download = 'push-reports.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (err) { setError(err.message); } finally { setExporting(false); }
  };
  return <div className="overview-page"><WebsiteHeader activePage="reports" domains={domains} domainKey={domainKey} domainName={domain?.domain_name} onAllSites={onAllSites} onManageDomains={onManageDomains} onSettings={onSettings} onSelectDomain={onSelectDomain} onDashboard={() => onDashboard?.(domainKey, domain?.domain_name)} onConfiguration={onConfiguration} onLogout={onLogout} />
    <main className="overview-main reports-main"><nav className="analytics-navigation" aria-label="Push navigation"><a href={`/push?domain=${encodeURIComponent(domainKey)}`}>Send Push</a><button disabled>Segments</button><span aria-current="page">Reports</span><a href={`/push/schedules?domain=${encodeURIComponent(domainKey)}`}>Schedule List</a><button disabled>Template Gallery</button><a href={`/push/settings?domain=${encodeURIComponent(domainKey)}`}>Push Setting</a><a href={`/analytics?domain=${encodeURIComponent(domainKey)}`}>Analytics</a></nav>
      <div className="analytics-heading"><h1>Push Reports</h1><div className="report-toolbar"><button className="overview-refresh" onClick={() => setRefresh(value => value + 1)}>Refresh reports</button><button className="overview-refresh" disabled={exporting} onClick={download}>{exporting ? 'Downloading...' : 'Download CSV'}</button></div></div>
      <form className="report-filters overview-panel" onSubmit={event => { event.preventDefault(); setPage(1); setApplied({ ...filters }); setRefresh(value => value + 1); }}><label>Search title<input maxLength={150} value={filters.q} onChange={event => update('q', event.target.value)} placeholder="Campaign title" /></label><label>From date (UTC)<input type="date" value={filters.from} onChange={event => update('from', event.target.value)} /></label><label>To date (UTC)<input type="date" min={filters.from || undefined} value={filters.to} onChange={event => update('to', event.target.value)} /></label><label>Status<select aria-label="Status" value={filters.status} onChange={event => update('status', event.target.value)}><option value="all">All statuses</option>{Object.entries(states).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><label>Tests<select aria-label="Tests" value={filters.tests} onChange={event => update('tests', event.target.value)}><option value="hide">Hide tests</option><option value="only">Tests only</option><option value="include">Include tests</option></select></label><button type="submit">Apply filters</button></form>
      <p className="report-note">Sent times use {domain?.time_zone || 'Asia/Kolkata'}. Date filters and CSV timestamps use UTC. Targeted counts are snapshots taken when sending starts.</p>
      {error && <p className="analytics-error" role="alert">{error}</p>}{!data && !error && <p role="status">Loading reports...</p>}
      {data && <><div className="overview-panel reports-panel"><ReportTable rows={data.rows} domainKey={domainKey} timeZone={domain?.time_zone} /></div><div className="report-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous page</button><span>Page {data.page} of {data.pages} · {data.total} campaigns</span><button disabled={page >= data.pages} onClick={() => setPage(value => value + 1)}>Next page</button></div></>}
      <div className="overview-panel report-explanation"><p><strong>Accepted is push-service acceptance, not confirmed delivery to a person.</strong> Browser acknowledgements and unique clicks are best-effort reports from updated service workers; offline or blocked tracking and older workers can undercount them. Each subscription counts once per campaign, including clicks on buttons.</p><p>Click rate = unique clicked subscriptions with confirmed push-service acceptance ÷ accepted notifications × 100. Historical schedule rows show Not tracked for missing telemetry. Earlier unsaved manual sends cannot be reconstructed.</p><p>To enable browser tracking on WordPress, <a href={`${API_BASE}/downloads/push-notifications-plugin.zip`}>download plugin v1.3.0</a>, replace the installed version, and revisit the website so the worker can update. Script installations should replace their push-sw.js. Existing notifications retain their original tracking capability.</p><p>Copy to draft opens the saved content in a new composer tab. It never sends automatically. Interrupted campaigns may have reached some browsers; inspect their results before sending again.</p></div>
    </main></div>;
}
