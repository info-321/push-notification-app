import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './targeting.css';

export const deviceChoices = [['windows', 'Windows desktop / laptop / tablet'], ['mac', 'Apple Mac desktop / laptop'], ['ipad', 'Apple iPad'], ['iphone', 'Apple iPhone'], ['android_phone', 'Android phone'], ['android_tablet', 'Android tablet'], ['other', 'Other recognized devices']];
export const browserChoices = [['Chrome', 'Google Chrome'], ['Safari', 'Safari'], ['Firefox', 'Mozilla Firefox'], ['Opera', 'Opera'], ['Edge', 'Microsoft Edge'], ['home_screen', 'Apple Home Screen web app'], ['Other', 'Other recognized browsers']];
export function TargetChoices({ label, choices, value, onChange, allowAll = true }) {
  const all = value === 'all';
  return <fieldset className="target-choices"><legend>{label}</legend>
    {allowAll && <select aria-label={`${label} selection`} value={all ? 'all' : 'selected'} onChange={event => onChange(event.target.value === 'all' ? 'all' : choices.map(([key]) => key))}><option value="all">All permitted by website rules</option><option value="selected">Selected only</option></select>}
    {!all && <div className="target-checkboxes">{choices.map(([key, title]) => <label key={key}><input type="checkbox" checked={value.includes(key)} onChange={event => onChange(event.target.checked ? [...value, key] : value.filter(item => item !== key))} />{title}</label>)}</div>}
  </fieldset>;
}
export function TargetSummary({ audience = {} }) {
  const names = (values, choices) => Array.isArray(values) ? choices.filter(([key]) => values.includes(key)).map(([, label]) => label).join(', ') : 'All permitted';
  return <><small>Devices: {names(audience.devices, deviceChoices)}</small><small>Browsers: {names(audience.browsers, browserChoices)}</small></>;
}
export default function TargetingSettings({ domainKey }) {
  const [policy, setPolicy] = useState(null), [saved, setSaved] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false; setPolicy(null); setError(''); setNotice('');
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/targeting`).then(async response => {
      const result = await response.json(); if (!response.ok || !result.ok || !['all', 'selected'].includes(result.data?.mode) || !Array.isArray(result.data.devices) || !Array.isArray(result.data.browsers)) throw new Error(result.message || 'Could not load targeting rules.');
      if (!cancelled) { setPolicy(result.data); setSaved(result.data); }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, reload]);
  const change = (key, value) => { setPolicy(current => ({ ...current, [key]: value })); setNotice(''); };
  const save = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const { mode, devices, browsers, version } = policy;
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/targeting`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, policy: { mode, devices, browsers } }) }), result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save targeting rules.');
      setPolicy(result.data); setSaved(result.data); setNotice('Device and browser rules saved for this website.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="overview-panel target-settings" aria-label="Device and browser targeting"><h2>Device &amp; Browser Targeting</h2>
    <p>Website-wide rules control subscription invitations, new registrations and all notification sends, including WordPress and scheduled sends. A device and a browser must both be allowed.</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setReload(n => n + 1)}>Reload targeting rules</button></p>}
    {!policy && !error && <p role="status">Loading targeting rules...</p>}
    {policy && <form onSubmit={save}><fieldset disabled={busy}><legend className="overview-sr-only">Website targeting rules</legend>
      <label>Audience access<select value={policy.mode} onChange={event => change('mode', event.target.value)}><option value="all">All supported devices and browsers</option><option value="selected">Only selected devices and browsers</option></select></label>
      <button type="button" className="target-preset" onClick={() => { setPolicy(current => ({ ...current, mode: 'selected', devices: ['mac', 'ipad', 'iphone'], browsers: ['Safari', 'home_screen'] })); setNotice('Preset selected. Save rules to apply it.'); }}>Use Apple + Safari / Home Screen preset</button>
      {policy.mode === 'selected' && <div className="target-columns"><TargetChoices label="Allowed devices" choices={deviceChoices} value={policy.devices} onChange={value => change('devices', value)} allowAll={false} /><TargetChoices label="Allowed browsers" choices={browserChoices} value={policy.browsers} onChange={value => change('browsers', value)} allowAll={false} /></div>}
      <p className="push-help">On iPhone and iPad, allow Safari for the installation guide and Apple Home Screen web app for notifications after installation. Mac Chrome is a different combination from Mac Safari. Detection is approximate; unrecognized and older unclassified records are excluded when restrictions are selected.</p>
      {policy.mode === 'selected' && (!policy.devices.length || !policy.browsers.length) && <p className="target-blocked">No device/browser combination is allowed. Saving will stop new prompts, registrations and future sends for this website.</p>}
      <p className="push-help">Confirm the selected combinations match your provider agreement. If another provider owns the notification worker scope, our SDK skips setup instead of replacing it. These rules cannot change the other provider's behavior.</p>
      <div className="target-save"><button type="submit">{busy ? 'Saving rules...' : 'Save device & browser rules'}</button><span>{JSON.stringify(policy) === JSON.stringify(saved) ? 'Saved rules' : 'Unsaved rules'}</span></div>
    </fieldset></form>}
    {notice && <p role="status">{notice}</p>}
    <p className="push-help">Rules are saved separately from prompt drafts and apply on subsequent website visits and send requests. Existing permission and subscriptions are preserved; a send already in progress may finish its current batch.</p>
  </section>;
}
