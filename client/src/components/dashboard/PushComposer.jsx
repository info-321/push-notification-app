import React, { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import WebsiteHeader from './WebsiteHeader';
import NotificationPreview from './NotificationPreview';
import BannerSettings, { newBanner } from './BannerSettings';
import ScheduleControls, { newSchedule, ScheduleSummary } from './ScheduleControls';
import './dashboard.css';
import './analytics.css';
import './push-composer.css';

const number = value => new Intl.NumberFormat().format(value);
const hostname = value => value.toLowerCase().replace(/^www\./, '');
export function validatePushDraft(draft, websites) {
  if (!draft.title.trim() || draft.title.length > 150) return 'Enter a title of up to 150 characters.';
  if (draft.body.length > 1000) return 'Keep the message within 1000 characters.';
  if (!websites.length) return 'Select at least one website.';
  try {
    if (!draft.url.trim()) throw new Error();
    for (const site of websites) {
      const target = new URL(draft.url, `https://${site.domain_name}`);
      if (target.protocol !== 'https:' || target.username || target.password || hostname(target.hostname) !== hostname(site.domain_name)) throw new Error();
    }
  } catch { return 'Use an HTTPS link on the selected website. For multiple websites, use a relative path such as /news/article.'; }
  if (draft.icon) {
    try { const icon = new URL(draft.icon); if (icon.protocol !== 'https:' || icon.username || icon.password || icon.port || draft.icon.length > 2048) throw new Error(); }
    catch { return 'Use a public HTTPS URL for the icon, or reset it to the default.'; }
  }
  if (draft.banner?.enabled) {
    if (draft.banner.image) {
      try { const image = new URL(draft.banner.image); if (image.protocol !== 'https:' || image.username || image.password || image.port) throw new Error(); }
      catch { return 'Use a public HTTPS URL for the banner image.'; }
    }
    if (draft.banner.actions.length > 2) return 'Use at most two notification buttons.';
    for (const item of draft.banner.actions) {
      if (!item.title.trim() || item.title.length > 40) return 'Enter a button label of up to 40 characters.';
      if (item.type === 'call') { if (!/^tel:\+?[0-9]{3,15}$/.test(item.url)) return 'Use a phone link such as tel:+911234567890.'; }
      else {
        for (const site of websites) {
          try { const target = new URL(item.url || draft.url, `https://${site.domain_name}`); if (target.protocol !== 'https:' || target.username || target.password || target.port || hostname(target.hostname) !== hostname(site.domain_name)) throw new Error(); }
          catch { return 'Button links must use HTTPS on the selected websites. Use a relative path for multiple websites.'; }
        }
      }
    }
  }
  return '';
}

function ChoiceIcon({ type }) {
  return <svg viewBox="0 0 80 80" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="5">{type === 'new' ? <><circle cx="40" cy="40" r="29" fill="currentColor" opacity=".28" stroke="none" /><path d="M40 23v34M23 40h34" strokeLinecap="round" /></> : type === 'templates' ? <><path d="M23 12h27l12 14v42H23z" fill="currentColor" opacity=".25" /><path d="M32 32h20M32 43h20M32 54h8" /></> : <><rect x="12" y="20" width="56" height="44" rx="4" fill="currentColor" opacity=".2" /><path d="M12 30h56M25 42l6 13 9-15 9 15 6-13M25 13h35" strokeWidth="3" /></>}</svg>;
}

export default function PushComposer({ domainKey, onAllSites, onManageDomains, onSettings, onSelectDomain, onDashboard, onConfiguration, onLogout }) {
  const [domains, setDomains] = useState([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1), [draft, setDraft] = useState({ title: '', body: '', url: '/', icon: '', banner: newBanner() });
  const [iconStatus, setIconStatus] = useState(''), [iconDirty, setIconDirty] = useState(false), [saveBanner, setSaveBanner] = useState(false), [busy, setBusy] = useState(false);
  const [sendMode, setSendMode] = useState('now'), [schedule, setSchedule] = useState(() => newSchedule()), [schedulePreview, setSchedulePreview] = useState(null);
  const schedulingKey = useRef(null);
  const savedIcon = useRef(''), savedBanner = useRef(newBanner()), saveQueue = useRef(Promise.resolve());
  const [selected, setSelected] = useState([domainKey]), [platform, setPlatform] = useState('all'), [subscribed, setSubscribed] = useState('all');
  const [webEnabled, setWebEnabled] = useState(true), [emojiField, setEmojiField] = useState('');
  const [error, setError] = useState(''), [audience, setAudience] = useState(null), [audienceError, setAudienceError] = useState('');
  const [countReload, setCountReload] = useState(0);
  const [reload, setReload] = useState(0), [sending, setSending] = useState(false), [finished, setFinished] = useState(false), [results, setResults] = useState([]);
  const sendLock = useRef(false), headingRef = useRef(null);
  const domain = domains.find(item => item.domain_key === domainKey);
  const websites = domains.filter(item => selected.includes(item.domain_key));

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError('');
    Promise.all([apiFetch(`${API_BASE}/api/domains`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok || !Array.isArray(result.data)) throw new Error(result.message || 'Could not load websites.');
      if (!result.data.some(site => site.domain_key === domainKey)) throw new Error('This website was not found. Choose another website.');
      return result.data;
    }), apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/push-defaults`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok || !result.data || Array.isArray(result.data)) throw new Error(result.message || 'Could not load notification defaults.');
      return result.data;
    })]).then(([sites, defaults]) => {
      if (cancelled) return;
      setDomains(sites); savedIcon.current = defaults.icon || ''; savedBanner.current = defaults.banner || newBanner();
      setSchedule(newSchedule(sites.find(site => site.domain_key === domainKey)?.time_zone || 'Asia/Kolkata'));
      setDraft(current => ({ ...current, icon: savedIcon.current, banner: savedBanner.current }));
      setIconStatus(savedIcon.current ? 'Icon saved for this website.' : 'The icon is saved automatically for this website.');
    }).catch(err => { if (!cancelled) setLoadError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domainKey, reload]);

  const saveIcon = useCallback(value => {
    const job = saveQueue.current.catch(() => {}).then(async () => {
      if (savedIcon.current === value) return true;
      if (value) {
        try { const icon = new URL(value); if (icon.protocol !== 'https:' || icon.username || icon.password || icon.port || value.length > 2048) throw new Error(); }
        catch { setIconStatus('Enter a public HTTPS icon URL to save it.'); return false; }
      }
      setIconStatus('Saving icon...');
      try {
        const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/push-defaults`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ icon: value }) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error();
        savedIcon.current = value; setIconStatus(value ? 'Icon saved for this website.' : 'Default icon restored and saved.'); return true;
      } catch { setIconStatus('Icon could not be saved. Click Next to retry.'); return false; }
    });
    saveQueue.current = job; return job;
  }, [domainKey]);
  useEffect(() => {
    if (!iconDirty || step !== 2) return;
    const timer = setTimeout(() => { saveIcon(draft.icon); }, 650);
    return () => clearTimeout(timer);
  }, [draft.icon, iconDirty, step, saveIcon]);

  useEffect(() => {
    let cancelled = false;
    setAudience(null); setAudienceError('');
    if (step !== 3 || !selected.length || !webEnabled || !domain) return;
    const query = new URLSearchParams({ platform, subscribed });
    Promise.all(selected.map(async key => {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(key)}/send-audience?${query}`);
      const result = await response.json();
      if (!response.ok || !result.ok || !Number.isSafeInteger(result.data?.matching)) throw new Error(result.message || 'Could not count this audience.');
      return result.data;
    })).then(rows => { if (!cancelled) setAudience({ matching: rows.reduce((sum, row) => sum + row.matching, 0), unknown: rows.reduce((sum, row) => sum + row.device_unknown, 0) }); })
      .catch(err => { if (!cancelled) setAudienceError(err.message); });
    return () => { cancelled = true; };
  }, [step, selected, platform, subscribed, webEnabled, domain, countReload]);

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [step]);
  const move = next => { if (sendLock.current || finished) return; setError(''); setStep(next); };
  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const navigate = callback => (...args) => { if (!sendLock.current) callback?.(...args); };
  const next = async event => {
    event.preventDefault(); const message = validatePushDraft(draft, [domain]);
    if (message) { setError(message); return; }
    if (sendMode !== 'now' && !schedulePreview) { setError('Choose a valid schedule and wait for the upcoming times to load.'); return; }
    if (busy) return;
    setBusy(true); setError('');
    if (!await saveIcon(draft.icon)) { setBusy(false); setError('Could not save the icon. Check its URL and try Next again.'); return; }
    if (saveBanner) {
      try {
        const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/push-defaults`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banner: draft.banner }) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save banner defaults.');
        savedBanner.current = JSON.parse(JSON.stringify(draft.banner));
      } catch (err) { setBusy(false); setError(err.message); return; }
    }
    setIconDirty(false); setBusy(false); move(3);
  };
  const send = async () => {
    if (sendLock.current || finished || !webEnabled || !audience || (sendMode === 'now' && !audience.matching)) return;
    const message = validatePushDraft(draft, websites);
    if (message) { setError(message); return; }
    if (sendMode !== 'now' && !schedulingKey.current) {
      if (!window.crypto?.getRandomValues) { setError('Open the dashboard over HTTPS to create a schedule.'); return; }
      const bytes = window.crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      schedulingKey.current = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    sendLock.current = true; setSending(true); setError(''); setResults([]);
    for (const site of websites) {
      let outcome;
      try {
        const response = await apiFetch(`${API_BASE}${sendMode === 'now' ? '/api/notifications/compose' : '/api/schedules'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain_key: site.domain_key, title: draft.title.trim(), body: draft.body, url: draft.url, icon: draft.icon, ...(draft.banner.enabled ? { banner: draft.banner } : {}), audience: { platform, subscribed }, ...(sendMode === 'now' ? {} : { schedule, request_key: schedulingKey.current }) }) });
        const result = await response.json();
        outcome = { name: site.domain_name, ok: response.ok && result.ok && !(result.failed > 0), message: result.message || 'Could not complete this send.' };
      } catch { outcome = { name: site.domain_name, ok: false, message: sendMode === 'now' ? 'The send status could not be confirmed. Some notifications may have been accepted; this request will not be retried automatically.' : 'Schedule creation could not be confirmed. Check Schedule List before creating it again; this request will not be retried automatically.' }; }
      setResults(current => [...current, outcome]);
    }
    setSending(false); setFinished(true); sendLock.current = false;
  };
  const reset = () => { setFinished(false); setResults([]); setDraft({ title: '', body: '', url: '/', icon: savedIcon.current, banner: JSON.parse(JSON.stringify(savedBanner.current)) }); setSaveBanner(false); setSelected([domainKey]); setPlatform('all'); setSubscribed('all'); setWebEnabled(true); setSendMode('now'); setSchedule(newSchedule(domain?.time_zone || 'Asia/Kolkata')); setSchedulePreview(null); schedulingKey.current = null; setStep(1); setError(''); };

  return <div className="overview-page push-composer-page">
    <WebsiteHeader activePage="push" domains={domains} domainKey={domainKey} domainName={domain?.domain_name} onAllSites={navigate(onAllSites)} onManageDomains={navigate(onManageDomains)} onSettings={navigate(onSettings)} onSelectDomain={navigate(onSelectDomain)} onDashboard={() => navigate(onDashboard)(domainKey, domain?.domain_name)} onConfiguration={navigate(onConfiguration)} onLogout={navigate(onLogout)} />
    <main className="overview-main push-main">
      <nav className="analytics-navigation" aria-label="Push navigation"><span aria-current="page">Send Push</span><button disabled>Segments</button><a href={`/dashboard?domain=${encodeURIComponent(domainKey)}#overview-reports`}>Reports</a><a href={`/push/schedules?domain=${encodeURIComponent(domainKey)}`}>Schedule List</a><button disabled>Template Gallery</button><a href={`/push/settings?domain=${encodeURIComponent(domainKey)}`}>Push Setting</a><a href={`/analytics?domain=${encodeURIComponent(domainKey)}`}>Analytics</a></nav>
      <h1 className="overview-sr-only">Send Push for {domain?.domain_name || 'your website'}</h1>
      {loading && <p role="status">Loading websites...</p>}
      {loadError && <div className="overview-panel push-message" role="alert">{loadError}<button onClick={() => setReload(value => value + 1)}>Try again</button></div>}
      {!loading && !loadError && domain && <section className="overview-panel push-wizard" aria-label="Create push notification">
        <ol className="push-steps" aria-label="Push creation steps">{[1, 2, 3].map(value => <li key={value} className={step >= value ? 'is-complete' : ''}><button type="button" disabled={value > step || sending || finished || busy} aria-current={value === step ? 'step' : undefined} onClick={() => move(value)}><span>{value < step ? '✓' : value === step ? '●' : '✓'}</span>Step {value}</button></li>)}</ol>
        <div ref={headingRef} tabIndex={-1} className="push-step-content" role="group" aria-label={`Step ${step} content`}>
          {error && <p className="analytics-error" role="alert">{error}</p>}
          {step === 1 ? <div className="push-start-options">
            <button type="button" className="push-choice push-choice-new" onClick={() => move(2)}><small>Create</small><strong>New Push</strong><ChoiceIcon type="new" /></button>
            <button type="button" className="push-choice push-choice-templates" disabled title="Templates are not available yet"><small>Select from</small><strong>Templates</strong><ChoiceIcon type="templates" /><span>Coming soon</span></button>
            <button type="button" className="push-choice push-choice-url" disabled title="URL import is not available yet"><small>Fetch from</small><strong>URL</strong><ChoiceIcon type="url" /><span>Coming soon</span></button>
          </div> : <div className="push-compose-grid">
            <div className="push-editor">
              {step === 2 ? <form onSubmit={next}>
                <fieldset className="push-compose-fields" disabled={busy}><legend className="overview-sr-only">Notification content</legend>
                <label htmlFor="push-url">URL</label><input id="push-url" required maxLength={2048} value={draft.url} onChange={event => update('url', event.target.value)} placeholder="https://your-website.com/article" />
                <label htmlFor="push-title">Title</label><div className="push-emoji-input"><input id="push-title" required maxLength={150} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="Push title" /><button type="button" aria-label="Choose an emoji for the title" onClick={() => setEmojiField(emojiField === 'title' ? '' : 'title')}>☺</button></div>
                <label htmlFor="push-body">Message</label><div className="push-emoji-input"><textarea id="push-body" maxLength={1000} rows={5} value={draft.body} onChange={event => update('body', event.target.value)} placeholder="Push message" /><button type="button" aria-label="Choose an emoji for the message" onClick={() => setEmojiField(emojiField === 'body' ? '' : 'body')}>☺</button></div>
                {emojiField && <div className="push-emoji-picker" role="group" aria-label={`Emoji for ${emojiField}`}>{['🔔', '✈️', '🌍', '📣', '✨', '🎉'].map(emoji => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => { if (draft[emojiField].length + emoji.length <= (emojiField === 'title' ? 150 : 1000)) update(emojiField, draft[emojiField] + emoji); setEmojiField(''); }}>{emoji}</button>)}</div>}
                <label htmlFor="push-icon">Icon</label><div className="push-icon-input"><input id="push-icon" type="url" maxLength={2048} value={draft.icon} onBlur={() => saveIcon(draft.icon)} onChange={event => { update('icon', event.target.value); setIconDirty(true); setIconStatus('Icon not saved yet.'); }} placeholder="Optional public HTTPS icon URL" /><button type="button" onClick={() => { update('icon', ''); setIconDirty(true); saveIcon(''); }}>Reset</button></div>
                <p className="push-help" role="status">{iconStatus}</p>
                <p className="push-help">Use a relative URL such as /news/article when sending to several websites.</p>
                <BannerSettings banner={draft.banner} domainKey={domainKey} onChange={value => update('banner', value)} saveDefaults={saveBanner} onSaveDefaults={setSaveBanner} onBusy={setBusy} />
                <div className="push-options" role="group" aria-label="Sending time">{[['now', 'Send Now'], ['once', 'Schedule One Time'], ['recurring', 'Schedule Recurring']].map(([mode, label]) => <button type="button" key={mode} aria-pressed={sendMode === mode} onClick={() => { setSendMode(mode); setSchedulePreview(null); if (mode !== 'now') setSchedule(current => ({ ...current, kind: mode })); }}>{label}</button>)}</div>
                {sendMode !== 'now' && <ScheduleControls value={schedule} onChange={setSchedule} onPreview={setSchedulePreview} />}
                <div className="push-form-actions"><button type="button" disabled={busy} className="push-back" onClick={() => move(1)}>Back</button><button disabled={busy || (sendMode !== 'now' && !schedulePreview)} className="push-primary" type="submit">{busy ? 'Please wait...' : 'Next'}</button></div>
                </fieldset>
              </form> : <>
                <h2>Choose Audience</h2>
                {sendMode !== 'now' && <ScheduleSummary value={schedule} upcoming={schedulePreview?.upcoming || []} />}
                <fieldset disabled={sending || finished} className="push-audience-fields"><legend className="overview-sr-only">Audience settings</legend>
                  <div className="push-domain-label"><span>Domains</span><button type="button" onClick={() => setSelected(domains.map(site => site.domain_key))}>Select All</button></div>
                  <div className="push-domain-options">{domains.map(site => <label key={site.domain_key}><input type="checkbox" checked={selected.includes(site.domain_key)} onChange={event => setSelected(current => event.target.checked ? [...current, site.domain_key] : current.filter(key => key !== site.domain_key))} />{site.domain_name}</label>)}</div>
                  <div className="push-audience-web"><label className="push-audience-toggle">Send to Web Subscribers<input type="checkbox" checked={webEnabled} onChange={event => setWebEnabled(event.target.checked)} /></label>
                    {webEnabled && <div className="push-audience-inner"><p>Select Audience</p><div className="push-options"><button type="button" aria-pressed="true">Default</button><button type="button" disabled title="Custom segments are not available yet">Custom</button></div>
                      <p>Platform</p><div className="push-options" role="group" aria-label="Audience platform">{[['all', 'All'], ['mobile', 'Mobile'], ['desktop', 'Desktop']].map(([value, label]) => <button type="button" key={value} aria-pressed={platform === value} onClick={() => setPlatform(value)}>{label}</button>)}</div>
                      <p>Users who subscribed in</p><div className="push-options push-period-options" role="group" aria-label="Subscription period">{[['all', 'All'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['15d', '15 days'], ['30d', '1 month']].map(([value, label]) => <button type="button" key={value} aria-pressed={subscribed === value} onClick={() => setSubscribed(value)}>{label}</button>)}</div>
                      <p className="push-help">Yesterday uses UTC. The other periods cover the last 7, 15, or 30 days.</p>
                    </div>}
                  </div>
                  <div className="push-unavailable">Send to App Subscribers<input type="checkbox" disabled aria-label="App subscribers unavailable" /></div>
                </fieldset>
                {!finished && <div className="push-audience-count" aria-live="polite">{!selected.length ? 'Select at least one website.' : !webEnabled ? 'Enable web subscribers to send.' : audienceError ? <p role="alert">{audienceError} <button onClick={() => setCountReload(value => value + 1)}>Refresh audience</button></p> : audience ? <><strong>{number(audience.matching)}</strong> matching subscriptions across {websites.length} {websites.length === 1 ? 'website' : 'websites'}.{platform !== 'all' && audience.unknown > 0 && <p>{number(audience.unknown)} subscriptions have unknown device types and are excluded from this platform filter.</p>}</> : 'Counting matching subscriptions...'}</div>}
                {sending && <p role="status">{sendMode === 'now' ? 'Sending notifications. Keep this tab open until the result appears.' : 'Saving schedules. Keep this tab open until confirmation appears.'}</p>}
                {results.length > 0 && <div className="push-results" aria-live="polite">{results.map(result => <p key={result.name} className={result.ok ? 'is-success' : 'is-error'}><strong>{result.name}</strong>{result.message}</p>)}</div>}
                {finished ? <><button className="push-primary" onClick={reset}>Create another notification</button>{sendMode !== 'now' && <p><a href={`/push/schedules?domain=${encodeURIComponent(domainKey)}`}>View Schedule List</a></p>}</> : <div className="push-form-actions"><button className="push-back" disabled={sending} onClick={() => move(2)}>Back</button><button className="push-primary" type="button" disabled={sending || !webEnabled || !selected.length || !audience || (sendMode === 'now' && !audience.matching) || Boolean(audienceError)} onClick={send}>{sending ? sendMode === 'now' ? 'Sending...' : 'Scheduling...' : sendMode === 'now' ? 'Send Push Now' : 'Schedule Push'}</button></div>}
                <p className="push-help">{sendMode === 'now' ? 'Sends immediately to the matching subscriptions on the selected websites. Push-service acceptance does not confirm device delivery.' : 'The backend recalculates this audience at each send time. Current counts can change, including when there are no subscribers yet. The dashboard can be closed after the schedule is saved.'}</p>
              </>}
            </div>
            <NotificationPreview draft={draft} domainName={step === 3 ? websites[0]?.domain_name || domain.domain_name : domain.domain_name} />
          </div>}
        </div>
      </section>}
    </main>
  </div>;
}
