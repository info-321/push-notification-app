import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './prompt-settings.css';
import { promptTemplateName } from './prompt-templates';

export default function PromptPerformance({ domainKey }) {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today.slice(0, 8) + '01'), [end, setEnd] = useState(today);
  const [range, setRange] = useState({ start, end }), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/prompt-performance?${new URLSearchParams(range)}`).then(async response => {
      const result = await response.json(); if (!response.ok || !result.ok || !Array.isArray(result.data?.rows)) throw new Error(result.message || 'Could not load prompt performance.');
      if (!cancelled) setData(result.data);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, range, refresh]);
  const totals = data?.rows.reduce((sum, row) => { for (const key of ['views', 'clicks', 'dismissals', 'subscriptions']) sum[key] += row[key]; return sum; }, { views: 0, clicks: 0, dismissals: 0, subscriptions: 0 });
  return <section className="prompt-performance" aria-label="Prompt Performance">
    <div className="prompt-section-heading"><div><h2>Prompt Performance</h2><p>Desktop, laptop & tablet · custom prompt views · UTC</p></div><button type="button" className="overview-refresh" onClick={() => setRefresh(value => value + 1)}>Refresh performance</button></div>
    <form className="prompt-date-range" onSubmit={event => { event.preventDefault(); const days = (Date.parse(end) - Date.parse(start)) / 86400000; if (!Number.isFinite(days) || days < 0 || days >= 366 || end > today) { setError('Choose dates in order, up to today, spanning at most 366 days.'); return; } setRange({ start, end }); }}><label>From<input required type="date" value={start} max={end} onChange={event => setStart(event.target.value)} /></label><label>To<input required type="date" value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} /></label><button type="submit">Apply dates</button></form>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading prompt performance...</p>}
    {totals && <><div className="prompt-stat-grid">{[['Prompt views', totals.views], ['Enable clicks', totals.clicks], ['New subscribers', totals.subscriptions], ['Conversion rate', totals.views ? `${(totals.subscriptions / totals.views * 100).toFixed(1)}%` : '—']].map(([label, value]) => <article key={label} className="overview-panel"><strong>{value}</strong><span>{label}</span></article>)}</div>
      <div className="overview-panel analytics-table-scroll"><table><caption className="overview-sr-only">Prompt results by published version</caption><thead><tr>{['Template', 'Views', 'Enable clicks', 'Dismissed', 'New subscribers', 'Conversion'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={row.revision}><td>{promptTemplateName(row.template)} <small>Version in this period: {index + 1}</small></td><td>{row.views}</td><td>{row.clicks}</td><td>{row.dismissals}</td><td>{row.subscriptions}</td><td>{row.views ? `${(row.subscriptions / row.views * 100).toFixed(1)}%` : '—'}</td></tr>)}{!data.rows.length && <tr><td colSpan={6}>No recorded prompt activity in this period. Publish a template to start collecting results.</td></tr>}</tbody></table></div></>}
    <p className="prompt-muted">Counts reflect custom prompt displays, not unique people or browser permission-dialog displays. Existing subscription refreshes are excluded from conversions. Browser restrictions, blocked requests and failed tracking can leave gaps. Versions are listed newest first; comparisons are observational, not an A/B test.</p>
  </section>;
}
