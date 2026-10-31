import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import WebsiteHeader from './WebsiteHeader';
import { scheduleDate } from './ScheduleControls';
import './dashboard.css';
import './analytics.css';
import './schedules.css';

const statusName = status => ({ active: 'Scheduled', paused: 'Paused', running: 'Sending', sending: 'Sending', completed: 'Completed', missed: 'Missed', needs_review: 'Needs review', cancelled: 'Cancelled', partial: 'Partially accepted', failed: 'Failed', skipped: 'Skipped', interrupted: 'Interrupted' })[status] || status;
const read = async path => { const response = await apiFetch(API_BASE + path), result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load schedules.'); return result.data; };
export default function ScheduleList({ domainKey, onAllSites, onManageDomains, onSettings, onSelectDomain, onDashboard, onConfiguration, onLogout }) {
  const [domains, setDomains] = useState([]), [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0), [page, setPage] = useState(1), [busy, setBusy] = useState(''), [worker, setWorker] = useState(null), [history, setHistory] = useState(null);
  const domain = domains.find(site => site.domain_key === domainKey);
  useEffect(() => {
    let cancelled = false; setError(''); setData(null);
    Promise.all([read('/api/domains'), read(`/api/domains/${encodeURIComponent(domainKey)}/schedules?page=${page}`), read('/api/schedules/status')]).then(([sites, jobs, status]) => { if (!cancelled) { setDomains(sites); setData(jobs); setWorker(status); } }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, page, refresh]);
  const action = async (job, next) => {
    setBusy(job.id); setError(''); setNotice('');
    try { const response = await apiFetch(`${API_BASE}/api/schedules/${encodeURIComponent(job.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: next }) }); const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.message || 'Could not update schedule.'); setNotice(result.message); setRefresh(value => value + 1); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const viewHistory = async job => {
    setBusy(job.id); setError('');
    try { const runs = await read(`/api/schedules/${encodeURIComponent(job.id)}/runs`); setHistory({ job, runs }); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  return <div className="overview-page"><WebsiteHeader activePage="push" domains={domains} domainKey={domainKey} domainName={domain?.domain_name} onAllSites={onAllSites} onManageDomains={onManageDomains} onSettings={onSettings} onSelectDomain={onSelectDomain} onDashboard={() => onDashboard?.(domainKey, domain?.domain_name)} onConfiguration={onConfiguration} onLogout={onLogout} />
    <main className="overview-main schedule-list-main"><nav className="analytics-navigation" aria-label="Push navigation"><a href={`/push?domain=${encodeURIComponent(domainKey)}`}>Send Push</a><button disabled>Segments</button><a href={`/push/reports?domain=${encodeURIComponent(domainKey)}`}>Reports</a><span aria-current="page">Schedule List</span><button disabled>Template Gallery</button><a href={`/push/settings?domain=${encodeURIComponent(domainKey)}`}>Push Setting</a><a href={`/analytics?domain=${encodeURIComponent(domainKey)}`}>Analytics</a></nav>
      <div className="analytics-heading"><h1>Scheduled notifications</h1><button className="overview-refresh" onClick={() => setRefresh(value => value + 1)}>Refresh schedules</button></div>
      {worker && <p className={worker.running ? 'schedule-worker-ready' : 'analytics-error'} role="status">{worker.running ? 'Backend scheduler is running. Your dashboard can stay closed.' : 'Scheduler heartbeat is unavailable. Check the backend before relying on scheduled sends.'}</p>}
      {error && <p className="analytics-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading schedules...</p>}
      {data && <><div className="overview-panel analytics-table-scroll schedule-table"><table><caption className="overview-sr-only">Scheduled notifications for this website</caption><thead><tr>{['Notification', 'Schedule', 'Next send', 'Status', 'Latest result', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map(job => <tr key={job.id}><td><strong>{job.content.title}</strong><small>{job.content.audience.platform} · {job.content.audience.subscribed}</small></td><td>{job.schedule.kind === 'once' ? 'One time' : `Every ${job.schedule.interval} ${job.schedule.frequency === 'daily' ? 'day(s)' : job.schedule.frequency === 'weekly' ? 'week(s)' : 'month(s)'}`}<small>{job.schedule.time_zone}</small></td><td>{job.next_run_at ? scheduleDate(job.next_run_at, job.schedule.time_zone) : '—'}</td><td><span className={`schedule-state ${job.status}`}>{statusName(job.status)}</span>{job.last_error && <small>{job.last_error}</small>}</td><td>{job.last_result ? `${job.last_result.sent} accepted · ${job.last_result.failed} failed · ${job.last_result.removed} expired` : 'No completed send yet'}</td><td><div className="schedule-actions">{job.status === 'active' && <button disabled={!!busy} onClick={() => action(job, 'pause')}>Pause</button>}{['paused', 'needs_review'].includes(job.status) && (job.schedule.kind === 'recurring' || job.status === 'paused') && <button disabled={!!busy} onClick={() => action(job, 'resume')}>Resume future sends</button>}{['active', 'paused', 'needs_review'].includes(job.status) && <button disabled={!!busy} onClick={() => action(job, 'cancel')}>Cancel schedule</button>}<button disabled={!!busy} onClick={() => viewHistory(job)}>History</button></div></td></tr>)}{!data.rows.length && <tr><td colSpan={6}>No schedules yet. Create a notification and choose Schedule One Time or Schedule Recurring.</td></tr>}</tbody></table></div><div className="schedule-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous page</button><span>Page {data.page} of {data.pages} · {data.total} schedules</span><button disabled={page >= data.pages} onClick={() => setPage(value => value + 1)}>Next page</button></div></>}
      {history && <section className="overview-panel schedule-history" aria-label="Schedule history"><div className="analytics-heading"><h2>{history.job.content.title} — latest 20 occurrences</h2><button onClick={() => setHistory(null)}>Close history</button></div>{history.runs.length ? <ol>{history.runs.map(run => <li key={run.due_at}><strong>{scheduleDate(run.due_at, history.job.schedule.time_zone)} · {statusName(run.status)}</strong><p>{run.message || 'Send is in progress.'}</p>{run.result && <p>Accepted: {run.result.sent}. Failed: {run.result.failed}. Expired removed: {run.result.removed}.</p>}</li>)}</ol> : <p>No occurrences have run yet.</p>}</section>}
      <p className="push-help">Audience filters are evaluated at send time. Missed occurrences beyond 15 minutes are skipped instead of sent in a burst. An interrupted send is held for review and never retried automatically. Resuming recurrence uses only future occurrences. Push-service acceptance does not confirm device delivery.</p>
    </main></div>;
}
