import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import WebsiteHeader from './WebsiteHeader';
import PromptPerformance from './PromptPerformance';
import { promptTemplates, mobilePromptTemplates } from './prompt-templates';
import './dashboard.css';
import './analytics.css';
import './prompt-settings.css';

export default function PromptSettings({ domainKey, onAllSites, onManageDomains, onSettings, onSelectDomain, onDashboard, onConfiguration, onLogout }) {
  const [domains, setDomains] = useState([]), [state, setState] = useState(null), [draft, setDraft] = useState(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  const [group, setGroup] = useState('large'), [preview, setPreview] = useState('desktop'), [previewAction, setPreviewAction] = useState('');
  const [stickyExpanded, setStickyExpanded] = useState(false);
  const editCache = useRef({});
  const mobile = group === 'mobile';
  const changeGroup = next => {
    if (busy || next === group) return;
    if (state && draft) editCache.current[group] = { state, draft };
    setGroup(next); setState(null); setDraft(null); setError(''); setNotice(''); setPreviewAction(''); setStickyExpanded(false);
  };
  const domain = domains.find(site => site.domain_key === domainKey);
  useEffect(() => {
    let cancelled = false; setState(null); setDraft(null); setError('');
    const cached = editCache.current[group];
    if (cached) { setState(cached.state); setDraft(cached.draft); return; }
    const read = async path => { const response = await apiFetch(API_BASE + path), result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load prompt settings.'); return result.data; };
    Promise.all([read('/api/domains'), read(`/api/domains/${encodeURIComponent(domainKey)}/prompt-settings${mobile ? '?device=mobile' : ''}`)]).then(([sites, settings]) => {
      if (!sites.some(site => site.domain_key === domainKey) || !settings?.draft) throw new Error('Website not found.');
      if (!cancelled) { setDomains(sites); setState(settings); setDraft(settings.draft); }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [domainKey, group, mobile, reload]);
  const update = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setNotice(''); setPreviewAction(''); };
  const chooseTemplate = template => {
    setDraft(current => {
      if (current.template === template) return current;
      const standard = current.accent === '#12ad88' && current.background === '#ffffff' && current.text === '#25394b';
      const presets = { fullscreen: ['#18b96b', '#347db5', '#ffffff'], header: ['#168de0', '#246fa8', '#ffffff'], 'slide-up': ['#cfaa24', '#30343c', '#ffffff'] };
      const previous = presets[current.template];
      const usingPreset = previous && current.accent === previous[0] && current.background === previous[1] && current.text === previous[2];
      const colors = presets[template] || ['#12ad88', '#ffffff', '#25394b'];
      return { ...current, template, ...(standard || usingPreset ? { accent: colors[0], background: colors[1], text: colors[2] } : {}) };
    });
    setStickyExpanded(false); setPreviewAction(''); setNotice('');
  };
  const save = async operation => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const settings = { ...draft, include_paths: draft.include_paths.map(path => path.trim()).filter(Boolean), exclude_paths: draft.exclude_paths.map(path => path.trim()).filter(Boolean) };
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/prompt-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, device: group, version: state.version, settings }) });
      const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save prompt settings.');
      setState(result.data); setDraft(result.data.draft);
      setNotice(operation === 'save' ? 'Draft saved. The live website has not changed.' : operation === 'restore' ? 'Previous published settings restored for this device group.' : mobile ? 'Published for mobile phones. Desktop, laptop and tablet settings are unchanged.' : 'Published for desktop, laptop and tablet. Mobile settings are unchanged.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(state?.draft);
  return <div className="overview-page prompt-settings-page">
    <WebsiteHeader activePage="push-settings" domains={domains} domainKey={domainKey} domainName={domain?.domain_name} onAllSites={onAllSites} onManageDomains={onManageDomains} onSettings={onSettings} onSelectDomain={onSelectDomain} onDashboard={() => onDashboard?.(domainKey, domain?.domain_name)} onConfiguration={onConfiguration} onLogout={onLogout} />
    <main className="overview-main prompt-settings-main">
      <nav className="analytics-navigation" aria-label="Push navigation"><a href={`/push?domain=${encodeURIComponent(domainKey)}`}>Send Push</a><button disabled>Segments</button><a href={`/dashboard?domain=${encodeURIComponent(domainKey)}#overview-reports`}>Reports</a><button disabled>Schedule List</button><button disabled>Template Gallery</button><span aria-current="page">Push Setting</span><a href={`/analytics?domain=${encodeURIComponent(domainKey)}`}>Analytics</a></nav>
      <div className="prompt-section-heading"><div><p className="prompt-eyebrow">PUSH SETTING</p><h1>Subscription Prompt</h1><p>Choose how visitors discover and enable your website notifications.</p></div>{state && <span className={`prompt-live-badge ${state.published ? 'is-live' : ''}`}>{state.published ? state.published.settings.enabled ? 'Published' : 'Published · prompt off' : 'Current button is live'}</span>}</div>
      <div className="prompt-device-tabs" role="group" aria-label="Prompt device group"><button aria-pressed={group === 'large'} disabled={busy} onClick={() => changeGroup('large')}>Desktop, laptop & tablet</button><button aria-pressed={group === 'mobile'} disabled={busy} onClick={() => changeGroup('mobile')}>Mobile phones</button></div>
      {error && <p className="analytics-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => { if (dirty && !window.confirm('Reload settings and discard unsaved edits?')) return; delete editCache.current[group]; setReload(value => value + 1); }}>Reload settings</button></p>}
      {notice && <p className="prompt-notice" role="status">{notice}</p>}
      {!draft && !error && <p role="status">Loading subscription prompt settings...</p>}
      {mobile && <div className="prompt-mobile-intro"><h2>Mobile phone settings</h2><p>Publish a separate invitation for phones. Desktop, laptop and tablet templates keep their own settings.</p><p>On iPhone, web push requires a supported Home Screen web app. <a href="https://webkit.org/blog/13878/" target="_blank" rel="noopener noreferrer">iPhone setup requirements</a></p></div>}
      {draft && <>
        <div className="prompt-publish-info"><span>{dirty ? 'Unsaved edits' : state.published && JSON.stringify(state.published.settings) === JSON.stringify(draft) ? 'Draft matches published settings' : 'Draft · not published'}</span><span>{state.published ? `Last published ${new Date(state.published.published_at).toLocaleString()}` : 'Save a draft to prepare changes. Publish when ready.'}</span></div>
        <div className="prompt-editor-grid"><form className="overview-panel prompt-editor" onSubmit={event => { event.preventDefault(); save('save'); }}>
          <fieldset disabled={busy}><legend className="overview-sr-only">{mobile ? 'Mobile subscription prompt' : 'Larger-device subscription prompt'}</legend>
            <label className="prompt-enable"><span><strong>Enable custom prompt</strong><small>Publishing OFF hides the prompt on {mobile ? 'mobile phones' : 'larger devices'}.</small></span><input type="checkbox" checked={draft.enabled} onChange={event => update('enabled', event.target.checked)} /></label>
            <h2>Choose a template</h2><div className="prompt-template-gallery">{(mobile ? mobilePromptTemplates : promptTemplates).map(([key, title, description]) => <button key={key} type="button" aria-pressed={draft.template === key} onClick={() => chooseTemplate(key)}><span className={`prompt-template-mini ${key}`}><i /><i /><i /></span><strong>{title}</strong><small>{description}</small></button>)}</div>
            <h2>Content & appearance</h2>
            {!['button', 'native'].includes(draft.template) && <><label htmlFor="prompt-heading">Heading</label><input id="prompt-heading" maxLength={80} required value={draft.heading} onChange={event => update('heading', event.target.value)} /><label htmlFor="prompt-message">Message</label><textarea id="prompt-message" maxLength={240} required rows={3} value={draft.message} onChange={event => update('message', event.target.value)} /><label htmlFor="prompt-logo">Logo URL (optional)</label><input id="prompt-logo" type="url" maxLength={2048} value={draft.logo} onChange={event => update('logo', event.target.value)} placeholder="https://your-website.com/logo.png" /></>}
            <div className="prompt-two-fields"><label>Enable button label<input required maxLength={40} value={draft.allow_label} onChange={event => update('allow_label', event.target.value)} /></label><label>Dismiss label<input required maxLength={40} value={draft.dismiss_label} onChange={event => update('dismiss_label', event.target.value)} /></label></div>
            <div className="prompt-color-fields">{(draft.template === 'native' ? [['accent', 'Enable button color']] : [['accent', 'Button color'], ['background', 'Background'], ['text', 'Text color']]).map(([key, label]) => <label key={key}>{label}<input type="color" value={draft[key]} onChange={event => update(key, event.target.value)} /></label>)}</div>
            {['button', 'native', 'slide-in', 'sticky'].includes(draft.template) ? <label>Position<select value={draft.position} onChange={event => update('position', event.target.value)}><option value="right">{draft.template === 'sticky' ? 'Right edge' : 'Bottom right'}</option><option value="left">{draft.template === 'sticky' ? 'Left edge' : 'Bottom left'}</option></select></label> : <p className="prompt-muted">{draft.template === 'dialog' ? (mobile ? 'A compact invitation near the bottom of the phone screen.' : 'Shown at the top center of the page. This is a website invitation; the browser still controls its own permission dialog.') : draft.template === 'modal' ? 'Centered on the page with a backdrop. Visitors can dismiss it or press Escape.' : draft.template === 'header' ? 'Fixed to the top of the phone screen.' : draft.template === 'slide-up' ? 'Slides up from the bottom of the phone screen.' : 'Covers the page until visitors enable notifications, dismiss it, or press Escape.'}</p>}
            <h2>Display rules</h2><label>Show the custom prompt<select value={draft.trigger} onChange={event => update('trigger', event.target.value)}><option value="delay">After a delay</option><option value="scroll">After scrolling</option></select></label>
            <div className="prompt-two-fields">{draft.trigger === 'delay' ? <label>Delay (seconds)<input type="number" min={0} max={120} required value={draft.delay} onChange={event => update('delay', Number(event.target.value))} /></label> : <label>Scroll depth (%)<input type="number" min={10} max={90} required value={draft.scroll} onChange={event => update('scroll', Number(event.target.value))} /></label>}<label>Show again after dismissal (days)<input type="number" min={1} max={90} required value={draft.cooldown} onChange={event => update('cooldown', Number(event.target.value))} /></label></div>
            <label htmlFor="prompt-include">Show only on these paths (optional)</label><textarea id="prompt-include" rows={2} value={draft.include_paths.join('\n')} onChange={event => update('include_paths', event.target.value.split('\n'))} placeholder={'/news\n/events'} /><label htmlFor="prompt-exclude">Exclude these paths (optional)</label><textarea id="prompt-exclude" rows={2} value={draft.exclude_paths.join('\n')} onChange={event => update('exclude_paths', event.target.value.split('\n'))} placeholder={'/checkout\n/privacy'} /><p className="prompt-muted">One path per line. /news includes /news and its subpages. Exclusions take priority. Blank include paths means all pages.</p>
            <p className="prompt-muted">Subscribed or browser-blocked visitors are not prompted. Only an Enable click asks the browser for permission. Changes apply to new page visits after publishing.</p>
            <div className="prompt-save-actions"><button type="submit">{busy ? 'Saving...' : 'Save draft'}</button><button type="button" className="prompt-publish" onClick={() => save('publish')}>Publish to website</button><button type="button" disabled={!state.previous} onClick={() => save('restore')}>Restore previous published version</button></div>
          </fieldset>
        </form><aside className="prompt-preview-column"><div className="overview-panel prompt-preview-panel"><div className="prompt-section-heading"><h2>Live preview</h2><span>Preview only</span></div>{mobile ? <p className="prompt-phone-preview-label">Phone preview - touch layout</p> : <div className="prompt-device-tabs" role="group" aria-label="Preview device"><button aria-pressed={preview === 'desktop'} onClick={() => setPreview('desktop')}>Desktop / Laptop</button><button aria-pressed={preview === 'tablet'} onClick={() => setPreview('tablet')}>Tablet</button></div>}<div className={`prompt-browser-preview ${mobile ? 'phone' : preview}`}><div className="prompt-browser-bar"><i /><i /><i /><span>{domain?.domain_name}</span></div><div className="prompt-page-skeleton"><b /><i /><i /><i /><div /><i /><i /></div>
          {draft.enabled ? <div className={`prompt-preview-layer ${draft.template}`}>
            {draft.template === 'native' && <div className="prompt-native-example" role="img" aria-label="Illustrative browser permission prompt"><strong>{domain?.domain_name}</strong><p>Would like to send notifications</p><div><span>Block</span><span>Allow</span></div><small>Illustration only - actual browser appearance varies</small></div>}
            {draft.template === 'sticky' && !stickyExpanded ? <button type="button" className={`prompt-preview-sticky-tab ${draft.position}`} style={{ background: draft.accent }} aria-expanded="false" onClick={() => setStickyExpanded(true)}>{draft.allow_label}</button> : <section className={`prompt-sample ${draft.template} ${draft.position}`} style={{ background: draft.background, color: draft.text }} aria-label="Subscription prompt preview">
            {!['button', 'native'].includes(draft.template) && <><div className="prompt-sample-brand">{draft.logo ? <img key={draft.logo} src={draft.logo} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span aria-hidden="true">🔔</span>}<strong>{draft.heading}</strong></div><p>{draft.message}</p></>}
            <div className="prompt-sample-actions"><button type="button" style={{ background: draft.accent }} onClick={() => setPreviewAction('The browser permission request would open after this click. This preview does not request permission or record activity.')}>{draft.allow_label}</button><button type="button" aria-label={draft.dismiss_label} onClick={() => setPreviewAction('A dismissal would hide the prompt for the selected cooldown period.')}>{['button', 'native'].includes(draft.template) ? '×' : draft.dismiss_label}</button></div>
          </section>}</div> : <p className="prompt-preview-off">Custom prompt is off for {mobile ? 'mobile phones' : 'larger devices'}.</p>}</div><p className="prompt-muted" role="status">{previewAction || (draft.template === 'native' ? 'Native Opt-in uses an Enable button. A tap opens the real browser permission prompt; its wording and appearance cannot be customized.' : draft.template === 'sticky' && !stickyExpanded ? 'Click the edge tab to preview its invitation. Only the Enable button inside asks for permission on your website.' : 'Your website prompt is customizable. The browser controls the native Allow / Block dialog.')}</p></div><div className="prompt-browser-note"><strong>Built around visitor choice</strong><p>{['modal', 'fullscreen'].includes(draft.template) ? 'This template overlays the page. Visitors can decline or press Escape. Browser permission is requested only after an Enable click.' : 'These website invitations keep the page usable and request browser permission only after an Enable click.'}</p></div></aside></div>
      </>}
      <PromptPerformance key={`${domainKey}-${group}`} domainKey={domainKey} device={group} />
    </main>
  </div>;
}
