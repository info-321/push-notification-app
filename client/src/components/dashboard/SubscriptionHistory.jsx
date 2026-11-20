import React, { useEffect, useId, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';

const labels = { baseline: 'Existing at tracking start', added: 'Subscribed', unsubscribed: 'Unsubscribed', expired: 'Expired', domain_deleted: 'Website deleted' };

export default function SubscriptionHistory({ domainKey, refresh }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [offset, setOffset] = useState(0), [event, setEvent] = useState('');
  const filterId = useId();
  useEffect(() => {
    let cancelled = false; setError(''); setData(null);
    const query = new URLSearchParams({ offset: String(offset), ...(event ? { event } : {}) });
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/subscription-history?${query}`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load subscription history.');
      if (!cancelled && Array.isArray(result.data?.rows)) setData(result.data);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, refresh, offset, event]);

  return <section className="analytics-period-section" aria-label="Subscription lifecycle history">
    <h2>Subscription lifecycle history</h2>
    <div className="overview-panel" style={{ padding: 20 }}>
      <div className="subscription-history-filter"><label htmlFor={filterId}>Activity</label>
      <select id={filterId} value={event} onChange={e => { setEvent(e.target.value); setOffset(0); }}>
        <option value="">All activity</option><option value="unsubscribed">Unsubscribed</option><option value="expired">Expired</option><option value="added">Subscribed</option>
      </select></div>
      {error && <p role="alert" className="analytics-error">{error}</p>}
      {!data && !error && <p className="analytics-note" role="status">Loading subscription history...</p>}
      {data && <>
        <p className="analytics-note">Removal tracking started {new Date(data.started_ms).toLocaleString()}. Unsubscribed records are visitor opt-outs; expired records are push-service removals. Browser permission changes may only become known when the push service reports an expired subscription.</p>
        <div className="overview-table-scroll"><table aria-label="Subscription lifecycle events" style={{ width: '100%', textAlign: 'left', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr>{['Time', 'Subscription', 'Event', 'Device', 'Browser'].map(label => <th key={label} style={{ padding: 12, borderBottom: '1px solid #d9e3eb' }}>{label}</th>)}</tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.event_key}>{[new Date(row.occurred_ms).toLocaleString(), row.subscription_id, labels[row.event_type] || row.event_type, row.device_type || 'Unknown', row.browser_family || 'Unknown'].map((value, i) => <td key={i} style={{ padding: 12, borderBottom: '1px solid #e8edf2' }}>{value}</td>)}</tr>)}</tbody>
        </table></div>
        {!data.rows.length && <p className="analytics-note">No {event ? labels[event].toLowerCase() : 'subscription'} events in this history view.</p>}
        <div className="security-pagination"><button disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 50))}>Newer events</button><button disabled={data.rows.length < 50} onClick={() => setOffset(value => value + 50)}>Older events</button></div>
      </>}
    </div>
  </section>;
}
