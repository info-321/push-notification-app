import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import { deviceChoices, browserChoices } from './TargetingSettings';

export default function AudienceDiagnostics({ domainKey, domainName, refresh, iphoneTest = false }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setData(null); setError('');
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/subscription-diagnostics`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok || !Number.isSafeInteger(result.data?.total) || !Array.isArray(result.data.groups)) throw new Error(result.message || 'Could not load saved subscription details.');
      if (!cancelled) setData(result.data);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, refresh]);
  const name = (value, choices) => choices.find(([key]) => key === value)?.[1] || 'Not recorded yet';
  return <section className="audience-diagnostics" aria-label={`Saved subscriptions for ${domainName}`}><h3>{domainName}: saved subscriptions</h3>
    <p>No subscriptions match the current campaign and website rules. The records below cover all saved subscriptions for this website, before campaign filters.</p>
    {error ? <p role="alert">{error} Use Refresh audience to retry.</p> : !data ? <p role="status">Checking saved subscription records...</p> : <>
      <p><strong>{data.total}</strong> subscriptions saved. {data.unclassified > 0 && `${data.unclassified} do not yet have complete device/browser details.`}</p>
      {data.groups.length > 0 && <div className="audience-diagnostics-scroll"><table><caption className="overview-sr-only">Recorded device and browser combinations</caption><thead><tr><th>Device</th><th>Browser / app</th><th>Saved</th><th>Allowed by website</th></tr></thead><tbody>{data.groups.map(row => <tr key={`${row.device}:${row.browser}`}><td>{name(row.device, deviceChoices)}</td><td>{name(row.browser, browserChoices)}</td><td>{row.subscribers}</td><td>{row.allowed ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>}
      <p>{iphoneTest && <>For this iPhone test, look for <strong>Apple iPhone + Apple Home Screen web app</strong>. </>}Choosing Allow does not confirm that the subscription was saved successfully.</p>
      <p>{iphoneTest ? "After subscribing, fully close the website's Home Screen app from the iPhone app switcher, reopen its icon and wait about 10 seconds." : 'Reload your website in the subscribed test browser and wait about 10 seconds.'} Then click <strong>Refresh audience</strong> here. This lets the website reload its notification setup and refresh saved subscription details.</p>
    </>}
  </section>;
}
