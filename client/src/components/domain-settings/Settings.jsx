import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './domain-list.css';
import './settings.css';
import { timeZones } from './timezones';

function SettingsIcon({ type }) {
  const paths = {
    general: <><path d="m9 3 1 3 3 1-2 3 1 3-3 1-2-2-3 1-1-3 2-2-1-3 3-1Z" /><circle cx="8" cy="9" r="2" /><path d="m18 13 1 2 2 1-1 2v3h-3l-2-1-1-2 1-2v-2Z" /></>,
    push: <><path d="M7 3v5m10-5v5M5 8h14v3a7 7 0 0 1-14 0Zm7 10v4" /></>,
    ios: <><path d="M15 3c0 3-2 4-4 4 0-3 2-4 4-4ZM17 13c0-2 1-3 2-4-3-3-5-1-7-1S7 6 5 9s-1 8 2 11c2 2 3 0 5 0s3 2 5 0l2-4c-1 0-2-1-2-3Z" /></>,
    android: <><path d="m7 4-2-2m12 2 2-2M4 11a8 8 0 0 1 16 0Zm0 0v8h16v-8M8 19v3m8-3v3M2 12v5m20-5v5" /><path d="M8 7h.01M16 7h.01" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type] || paths.mail}</svg>;
}

function TextField({ id, label, ...props }) {
  return <div className="settings-field"><label htmlFor={id}>{label}</label><input id={id} {...props} /></div>;
}

function EmailToggle({ label, id }) {
  return <div className="settings-toggle-field"><label htmlFor={id}>{label}</label><button type="button" id={id} className="settings-switch" role="switch" aria-checked="false" aria-label={label} disabled><span />OFF</button></div>;
}

export default function Settings({ selectedDomainKey = '', onSelectDomain = () => {}, onBack = () => {}, onAccount = () => {}, onConfiguration = () => {}, onDashboard = () => {}, onLogout = () => {} }) {
  const [domains, setDomains] = useState([]);
  const [domainsError, setDomainsError] = useState('');
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [general, setGeneral] = useState(null);
  const [push, setPush] = useState(null);
  const [timeZone, setTimeZone] = useState('Asia/Kolkata');
  const [generalError, setGeneralError] = useState('');
  const [pushError, setPushError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showSender, setShowSender] = useState(false);
  const activeKey = selectedDomainKey || domains[0]?.domain_key || '';
  const activeDomain = domains.find(domain => domain.domain_key === activeKey);

  useEffect(() => {
    let cancelled = false;
    setDomainsLoading(true);
    setDomainsError('');
    apiFetch(`${API_BASE}/api/domains`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load websites.');
      if (!cancelled) setDomains(result.data);
    }).catch(error => { if (!cancelled) setDomainsError(error.message); })
      .finally(() => { if (!cancelled) setDomainsLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    setGeneral(null); setPush(null); setNotice(''); setGeneralError(''); setPushError(''); setShowSender(false);
    if (!activeKey) { setLoading(false); return; }
    setLoading(true);
    const read = async suffix => {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(activeKey)}/${suffix}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || `Could not load ${suffix}.`);
      return result.data;
    };
    Promise.allSettled([read('settings'), read('integration')]).then(([settings, integration]) => {
      if (cancelled) return;
      if (settings.status === 'fulfilled') { setGeneral(settings.value); setTimeZone(settings.value.time_zone); }
      else setGeneralError(settings.reason.message);
      if (integration.status === 'fulfilled') setPush(integration.value);
      else setPushError(integration.reason.message);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeKey, reload]);

  const updateGeneral = async event => {
    event.preventDefault();
    setSaving(true); setNotice(''); setGeneralError('');
    try {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(activeKey)}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time_zone: timeZone }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save settings.');
      setGeneral(current => ({ ...current, time_zone: result.data.time_zone }));
      setNotice('General settings updated.');
    } catch (error) { setGeneralError(error.message); }
    finally { setSaving(false); }
  };

  const configure = () => onConfiguration(activeKey, activeDomain?.domain_name || general?.domain_name || '');
  const retry = () => setReload(value => value + 1);

  return <div className="domain-list-page settings-screen">
    <header className="domain-list-header"><div className="settings-header-inner">
      <div className="domain-list-brand">
        <button type="button" className="domain-list-logo" onClick={() => onDashboard()} aria-label="All websites"><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
        <select aria-label="Select website" value={activeKey} disabled={!domains.length || saving} onChange={event => {
          const domain = domains.find(item => item.domain_key === event.target.value);
          if (domain) onSelectDomain(domain.domain_key, domain.domain_name);
        }}>
          {!activeDomain && <option value={activeKey}>{general?.domain_name || 'Select a website'}</option>}
          {domains.map(domain => <option key={domain.domain_key} value={domain.domain_key}>{domain.domain_name}</option>)}
        </select>
      </div>
      <div className="domain-list-account"><button className="domain-list-dashboard-link" onClick={() => onDashboard(activeKey, activeDomain?.domain_name)}>Dashboard</button>
        <div className="domain-list-profile"><button type="button" className="domain-list-profile-trigger" aria-label="Account menu" aria-expanded={showProfile} onClick={() => setShowProfile(value => !value)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M5 19c1-6 13-6 14 0" /></svg><span aria-hidden="true">⌄</span>
        </button>{showProfile && <div className="domain-list-profile-menu"><button onClick={onBack}>Domains</button><button onClick={onLogout}>Log out</button></div>}</div>
      </div>
    </div></header>

    <main className="settings-main">
      <nav className="domain-list-tabs" aria-label="Settings navigation">
        <button className="is-active" aria-current="page">Settings</button><button onClick={onAccount}>Account</button>
        <button onClick={configure} disabled={!activeKey || loading}>Configuration</button><button disabled title="Billing is not available yet">Plan &amp; Billing</button>
        <button onClick={onBack}>Domain</button><button disabled title="PWA settings are not available yet">PWA Setting</button><button disabled title="User management is not available yet">User</button>
      </nav>
      {domainsError && <p className="settings-error" role="alert">{domainsError} <button onClick={retry}>Try again</button></p>}
      {domainsLoading && !activeKey && <p role="status" className="settings-page-note">Loading websites…</p>}
      {!domainsLoading && !domainsError && !domains.length && <p role="status" className="settings-page-note">Add a website in <button onClick={onBack}>Domains</button> to configure its settings.</p>}

      <div className="settings-grid">
        <section className="settings-panel" aria-labelledby="general-settings-heading">
          <h1 id="general-settings-heading"><SettingsIcon type="general" />General Setting</h1>
          <form onSubmit={updateGeneral}>
            <div className="settings-field"><label htmlFor="settings-time-zone">Time Zone</label><select id="settings-time-zone" value={timeZone} onChange={event => setTimeZone(event.target.value)} disabled={!general || saving || loading}>
              {!timeZones.some(([value]) => value === timeZone) && <option value={timeZone}>{timeZone}</option>}
              {timeZones.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></div>
            <EmailToggle id="settings-feedback-email" label="Feedback Notification Email" />
            <EmailToggle id="settings-weekly-email" label="Weekly Report Email" />
            <EmailToggle id="settings-daily-email" label="Daily Report Email" />
            <p className="settings-help">Email notifications and reports are not enabled yet.</p>
            {loading && <p className="settings-help" role="status">Loading settings…</p>}
            {generalError && <p className="settings-error" role="alert">{generalError} <button type="button" onClick={retry}>Try again</button></p>}
            {notice && <p className="settings-success" role="status">{notice}</p>}
            <button type="submit" className="settings-update" disabled={!general || saving || loading}>{saving ? 'Updating…' : 'Update'}</button>
          </form>
        </section>

        <section className="settings-panel" aria-labelledby="push-settings-heading">
          <h2 id="push-settings-heading"><SettingsIcon type="push" />Push Sending Settings</h2>
          <TextField id="settings-project" label="Domain / Project Key" value={push?.domain_key || ''} placeholder="Select a configured website" readOnly />
          <div className="settings-field"><label htmlFor="settings-sender-key">Sender API Key</label><div className="settings-secret-field"><input id="settings-sender-key" type={showSender ? 'text' : 'password'} value={push?.sender_api_key || ''} readOnly autoComplete="off" /><button type="button" disabled={!push} onClick={() => setShowSender(value => !value)} aria-pressed={showSender}>{showSender ? 'Hide' : 'Show'}</button></div></div>
          <TextField id="settings-public-key" label="Public Key" value={push?.vapid_public_key || ''} readOnly />
          <TextField id="settings-private-key" label="Private Key" value={push ? 'Managed securely on the server' : ''} readOnly />
          <p className="settings-help">Web-push keys are managed automatically. Installation details are available in Configuration.</p>
          {pushError && <p className="settings-error" role="alert">{pushError} <button onClick={retry}>Try again</button></p>}
          <button type="button" className="settings-update" onClick={configure} disabled={!push || loading}>Open Configuration</button>
        </section>

        <section className="settings-panel settings-inactive" aria-labelledby="ios-settings-heading">
          <h2 id="ios-settings-heading"><SettingsIcon type="ios" />iOS Push Settings</h2><p className="settings-integration-status">Native iOS push is not enabled yet</p>
          <fieldset disabled><legend className="settings-sr-only">iOS integration</legend>
            <TextField id="settings-ios-file" label="Key (.p8 file)" type="file" accept=".p8" />
            <TextField id="settings-ios-key-id" label="Key ID" placeholder="Key ID" />
            <TextField id="settings-ios-team-id" label="Team ID" placeholder="Team ID" />
            <TextField id="settings-ios-bundle-id" label="App Bundle ID" placeholder="App Bundle ID" />
            <button type="button" className="settings-update">Update</button><button type="button" className="settings-sdk">↓ Download SDK</button>
          </fieldset>
        </section>

        <section className="settings-panel settings-inactive" aria-labelledby="android-settings-heading">
          <h2 id="android-settings-heading"><SettingsIcon type="android" />Android Push Settings</h2><p className="settings-integration-status">Native Android push is not enabled yet</p>
          <fieldset disabled><legend className="settings-sr-only">Android integration</legend>
            <TextField id="settings-android-project" label="Android Project ID" placeholder="Android Project ID" />
            <TextField id="settings-android-account" label="Android Service Account" type="file" accept="application/json,.json" />
            <button type="button" className="settings-update">Update</button>
          </fieldset>
        </section>

        <section className="settings-panel settings-inactive settings-mailchimp" aria-labelledby="mailchimp-settings-heading">
          <h2 id="mailchimp-settings-heading">Mailchimp Setting</h2><p className="settings-integration-status">Mailchimp is not connected</p>
          <fieldset disabled><legend className="settings-sr-only">Mailchimp integration</legend>
            <TextField id="settings-mailchimp-key" label="Mailchimp API Key" type="password" placeholder="Mailchimp API Key" autoComplete="off" />
            <TextField id="settings-mailchimp-list" label="Mailchimp List ID" placeholder="Mailchimp List ID" />
            <button type="button" className="settings-update">Update</button>
          </fieldset>
        </section>

        <section className="settings-panel settings-inactive" aria-labelledby="email-settings-heading">
          <h2 id="email-settings-heading"><SettingsIcon type="mail" />Email Settings</h2><p className="settings-integration-status">Email sending is not connected</p>
          <fieldset disabled><legend className="settings-sr-only">Email integration</legend>
            <div className="settings-field"><label htmlFor="settings-mail-type">Mail type</label><select id="settings-mail-type" defaultValue="SMTP"><option>SMTP</option></select></div>
            <TextField id="settings-smtp-host" label="SMTP Hostname" placeholder="SMTP Hostname" />
            <TextField id="settings-smtp-user" label="SMTP Username" placeholder="SMTP Username" autoComplete="off" />
            <TextField id="settings-smtp-password" label="SMTP Password" type="password" autoComplete="new-password" />
            <div className="settings-field"><span className="settings-label">SMTP Port</span><div className="settings-radio-group"><label><input type="radio" name="smtp-port" value="465" />465 (SSL)</label><label><input type="radio" name="smtp-port" value="587" />587 (TLS)</label></div></div>
            <TextField id="settings-email-from-name" label="From Name" placeholder="From Name" />
            <TextField id="settings-email-from" label="Verified Email Address (From Email)" type="email" placeholder="From Email" />
            <div className="settings-email-actions"><button type="button" className="settings-email-test">Send Test Email</button><button type="button" className="settings-update">Update</button></div>
          </fieldset>
        </section>
      </div>
    </main>
  </div>;
}
