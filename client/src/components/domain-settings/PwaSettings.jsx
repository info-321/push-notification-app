import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import { buildPwaManifest, downloadManifest, readPwaIcon } from './pwa-files';
import './domain-list.css';
import './pwa-settings.css';

const empty = { name: '', short_name: '', start_url: '', theme_color: '#ffffff', background_color: '#ffffff', icon_192: '', icon_512: '' };

function PreviewIcon({ icon }) {
  return icon ? <img src={icon} alt="" /> : <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a2 2 0 0 1 2 2v1c3 1 4 3 4 7v3l2 3H4l2-3v-3c0-4 1-6 4-7V4a2 2 0 0 1 2-2Zm-3 18h6a3 3 0 0 1-6 0Z" /></svg>;
}

function PhonePreview({ step, settings, hostname }) {
  const color = /^#[0-9a-f]{6}$/i;
  return <section className="pwa-preview" aria-label={`Preview - Step ${step}`}>
    <h2>Preview - Step {step}</h2>
    <div className={`pwa-phone pwa-phone-step-${step}`}>
      <div className="pwa-phone-speaker" />
      <div className="pwa-phone-screen" style={{ backgroundColor: color.test(settings.background_color) ? settings.background_color : '#ffffff' }}>
        <div className="pwa-phone-toolbar" style={{ backgroundColor: color.test(settings.theme_color) ? settings.theme_color : '#ffffff' }} />
        {step === 1 ? <div className="pwa-install-banner"><PreviewIcon icon={settings.icon_192} /><span>Add <strong>{settings.short_name || 'your app'}</strong> to Home screen</span><span aria-hidden="true">&#215;</span></div>
          : <div className="pwa-install-dialog"><h3>Add to Home screen</h3><div className="pwa-dialog-app"><PreviewIcon icon={settings.icon_192 || settings.icon_512} /><div><strong>{settings.name || 'Your app name'}</strong><small>{hostname || 'Your website'}</small></div></div><div className="pwa-dialog-actions"><span>Cancel</span><span>Add</span></div></div>}
      </div>
      <div className="pwa-phone-home" />
    </div>
  </section>;
}

export default function PwaSettings({ selectedDomainKey = '', onSelectDomain = () => {}, onSettings = () => {}, onAccount = () => {}, onConfiguration = () => {}, onDomains = () => {}, onDashboard = () => {}, onLogout = () => {} }) {
  const [domains, setDomains] = useState([]);
  const [settings, setSettings] = useState(empty);
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [iconErrors, setIconErrors] = useState({});
  const [reading, setReading] = useState({});
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const iconRequests = useRef({});
  const navigation = useRef(null);
  const activeKey = selectedDomainKey || domains[0]?.domain_key || '';
  const domain = domains.find(item => item.domain_key === activeKey);

  useEffect(() => {
    const showActiveTab = () => {
      const nav = navigation.current, tab = nav?.querySelector('[aria-current="page"]');
      if (tab && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += tab.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - tab.offsetWidth) / 2;
    };
    showActiveTab(); window.addEventListener('resize', showActiveTab);
    return () => window.removeEventListener('resize', showActiveTab);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${API_BASE}/api/domains`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load websites.');
      if (!cancelled) { setDomains(result.data); if (!result.data.length) setLoading(false); }
    }).catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    let cancelled = false;
    iconRequests.current = {};
    setSettings(empty); setSaved(null); setIconErrors({}); setReading({}); setNotice(''); setLoadedKey('');
    if (!activeKey) return () => { cancelled = true; };
    setLoading(true); setError('');
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(activeKey)}/pwa`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load PWA settings.');
      if (!cancelled) { setSettings(result.data.settings); setSaved(result.data.saved ? result.data.settings : null); setLoadedKey(activeKey); }
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; iconRequests.current = {}; };
  }, [activeKey, retry]);

  const update = event => { setSettings(current => ({ ...current, [event.target.name]: event.target.value })); setNotice(''); };
  const chooseIcon = async (event, size) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = Symbol(); iconRequests.current[size] = request;
    setReading(current => ({ ...current, [size]: true })); setIconErrors(current => ({ ...current, [size]: '' })); setNotice('');
    try {
      const data = await readPwaIcon(file, size);
      if (iconRequests.current[size] === request) setSettings(current => ({ ...current, [`icon_${size}`]: data }));
    } catch (err) { if (iconRequests.current[size] === request) setIconErrors(current => ({ ...current, [size]: err.message })); }
    finally { if (iconRequests.current[size] === request) setReading(current => ({ ...current, [size]: false })); }
  };

  const save = async event => {
    event.preventDefault(); setError(''); setNotice('');
    if (!settings.icon_192 || !settings.icon_512) { setError('Choose both required PNG icons before updating.'); return; }
    if (!/^#[0-9a-f]{6}$/i.test(settings.theme_color) || !/^#[0-9a-f]{6}$/i.test(settings.background_color)) { setError('Use six-digit hex colors, such as #ffffff.'); return; }
    setSaving(true);
    try {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(activeKey)}/pwa`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save PWA settings.');
      setSettings(result.data.settings); setSaved(result.data.settings); setIconErrors({});
      setNotice('PWA settings saved. Download the updated manifest and add it to your website.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const busy = loading || saving || !activeKey || loadedKey !== activeKey;
  const dirty = Boolean(saved && JSON.stringify(saved) !== JSON.stringify(settings));
  let hostname = domain?.domain_name || '';
  try { hostname = new URL(settings.start_url).hostname; } catch {}

  return <div className="domain-list-page pwa-screen">
    <header className="domain-list-header"><div className="domain-list-header-inner">
      <div className="domain-list-brand"><button type="button" className="domain-list-logo" aria-label="All websites" onClick={() => onDashboard()}><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
        <select aria-label="Select website" value={activeKey} disabled={!domains.length || saving} onChange={event => { const selected = domains.find(item => item.domain_key === event.target.value); if (selected) onSelectDomain(selected.domain_key, selected.domain_name); }}>
          {!domain && <option value={activeKey}>Select a website</option>}{domains.map(item => <option key={item.domain_key} value={item.domain_key}>{item.domain_name}</option>)}
        </select>
      </div>
      <div className="domain-list-account"><button className="domain-list-dashboard-link" onClick={() => onDashboard(activeKey, domain?.domain_name)}>Dashboard</button>
        <div className="domain-list-profile"><button type="button" className="domain-list-profile-trigger" aria-label="Account menu" aria-expanded={showProfile} onClick={() => setShowProfile(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M5 19c1-6 13-6 14 0" /></svg><span aria-hidden="true">&#8964;</span></button>{showProfile && <div className="domain-list-profile-menu"><button onClick={onSettings}>Settings</button><button onClick={onAccount}>Account</button><button onClick={onLogout}>Log out</button></div>}</div>
      </div>
    </div></header>
    <main className="domain-list-main">
      <nav ref={navigation} className="domain-list-tabs" aria-label="Settings navigation"><button onClick={onSettings}>Settings</button><button onClick={onAccount}>Account</button><button disabled={!activeKey} onClick={() => onConfiguration(activeKey, domain?.domain_name || '')}>Configuration</button><button onClick={onDomains}>Domain</button><button className="is-active" aria-current="page">PWA Setting</button><button disabled title="User management is not available yet">User</button></nav>
      {error && <p className="pwa-error" role="alert">{error}{!loadedKey && <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>}</p>}
      {loading && <p className="pwa-note" role="status">Loading PWA settings...</p>}
      {!loading && !activeKey && !error && <p className="pwa-note">Add a website in <button onClick={onDomains}>Domains</button> to configure its PWA.</p>}
      <div className="pwa-panel">
        <form className="pwa-form" onSubmit={save}>
          <h1>PWA Settings</h1>
          <fieldset disabled={busy}>
            <div className="pwa-field"><label htmlFor="pwa-name">Name <span>*</span></label><input id="pwa-name" name="name" value={settings.name} onChange={update} required maxLength={100} autoComplete="off" /></div>
            <div className="pwa-field"><label htmlFor="pwa-short-name">Short Name <span>*</span></label><input id="pwa-short-name" name="short_name" value={settings.short_name} onChange={update} required maxLength={30} autoComplete="off" /></div>
            <div className="pwa-field"><label htmlFor="pwa-start-url">Start URL</label><input id="pwa-start-url" name="start_url" type="url" value={settings.start_url} onChange={update} required maxLength={2048} /><small>Use your website's HTTPS address.</small></div>
            {[['theme_color', 'Theme Color'], ['background_color', 'Background Color']].map(([name, label]) => <div className="pwa-field" key={name}><label htmlFor={`pwa-${name}`}>{label}</label><div className="pwa-color-field"><input id={`pwa-${name}`} name={name} value={settings[name]} onChange={update} pattern="#[0-9a-fA-F]{6}" required maxLength={7} /><input type="color" aria-label={`Choose ${label.toLowerCase()}`} name={name} value={/^#[0-9a-f]{6}$/i.test(settings[name]) ? settings[name] : '#ffffff'} onChange={update} /></div></div>)}
            {[192, 512].map(size => <div className="pwa-field" key={size}><label htmlFor={`pwa-icon-${size}`}>Icon ({size}x{size}) <span>*</span></label><div className="pwa-file-field"><input id={`pwa-icon-${size}`} type="file" accept="image/png" onChange={event => chooseIcon(event, size)} aria-describedby={`pwa-icon-help-${size}`} aria-invalid={Boolean(iconErrors[size])} />{settings[`icon_${size}`] && <img src={settings[`icon_${size}`]} alt={`Selected ${size} pixel icon`} />}</div><small id={`pwa-icon-help-${size}`}>{reading[size] ? 'Reading icon...' : iconErrors[size] || (settings[`icon_${size}`] ? 'Icon ready. Choose a file to replace it.' : `PNG, exactly ${size} x ${size} pixels, up to 512 KB.`)}</small></div>)}
            <button type="submit" className="pwa-update" disabled={busy || Object.values(reading).some(Boolean) || Object.values(iconErrors).some(Boolean)}>{saving ? 'Updating...' : 'Update'}</button>
          </fieldset>
          {notice && <p role="status" className="pwa-success">{notice}</p>}
        </form>
        <div className="pwa-previews"><PhonePreview step={1} settings={settings} hostname={hostname} /><PhonePreview step={2} settings={settings} hostname={hostname} /><p className="pwa-preview-note">Illustrative previews. The install prompt varies by browser and device.</p></div>
      </div>
      <section className="pwa-downloads" aria-label="PWA downloads">
        <a className="pwa-download" href={`${API_BASE}/push-sw.js`} download="push-sw.js">Download push-sw.js</a>
        <button className="pwa-download" disabled={!saved || dirty || busy} onClick={() => downloadManifest(buildPwaManifest(saved, activeKey, API_BASE))}>Download push-pwa-manifest.json</button>
        <p className="pwa-note">{dirty ? 'Update your settings before downloading the latest manifest.' : saved ? 'Download the manifest and upload it to your website root. Replace it after each settings change.' : 'Save your settings to enable the manifest download. After each change, upload the new manifest to your website root.'}</p>
        <p className="pwa-note">Add this inside your website's <code>&lt;head&gt;</code>:</p><code className="pwa-install-code">&lt;link rel="manifest" href="/push-pwa-manifest.json"&gt;</code>
        <p className="pwa-note">The manifest uses your saved icons hosted by this API. In WordPress, keep the Push Notifications plugin's existing service worker. A second worker at the same scope can replace it. This setup adds install metadata; it does not add offline caching.</p>
      </section>
    </main>
  </div>;
}
