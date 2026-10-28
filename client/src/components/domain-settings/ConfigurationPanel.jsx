import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './configuration-screen.css';

function Chevron({ open }) {
  return <svg className={open ? 'is-open' : ''} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 2 6 6-6 6" /></svg>;
}

export default function ConfigurationPanel({ domainKey, onDomains = () => {} }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [openInstall, setOpenInstall] = useState('');
  const [showSender, setShowSender] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [title, setTitle] = useState('Test notification');
  const [body, setBody] = useState('Push notifications are connected.');
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!domainKey) { setLoading(false); return; }
    setLoading(true); setError(''); setDetails(null);
    const load = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/integration`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load configuration.');
        if (!cancelled) setDetails(result.data);
      } catch (err) { if (!cancelled) setError(err.message || 'Could not load configuration.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [domainKey, reload]);

  useEffect(() => {
    if (details && window.location.hash === '#send-push') {
      document.getElementById('send-push')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      document.getElementById('test-title')?.focus({ preventScroll: true });
    }
  }, [details]);

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); setCopyStatus(`${label} copied.`); }
    catch { setCopyStatus('Automatic copying is unavailable. Select the value to copy it manually.'); }
  };

  const sendTest = async event => {
    event.preventDefault();
    setSending(true); setSendResult(''); setSendError(false);
    try {
      const response = await apiFetch(`${API_BASE}/api/notifications`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_key: domainKey, title, body, url: url || '/' }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not send the test notification.');
      setSendResult(result.message);
    } catch (err) { setSendError(true); setSendResult(err.message); }
    finally { setSending(false); }
  };

  if (!domainKey) return <section className="configuration-card configuration-message"><p>Select a website to view its configuration.</p><button onClick={onDomains}>Choose a website</button></section>;
  if (loading) return <section className="configuration-card configuration-message" role="status">Loading configuration…</section>;
  if (error) return <section className="configuration-card configuration-message" role="alert"><p>{error}</p><button onClick={() => setReload(value => value + 1)}>Try again</button></section>;
  if (!details) return null;

  const publicConfig = JSON.stringify({ domainKey: details.domain_key, apiBase: details.api_base, vapidPublicKey: details.vapid_public_key, swPath: '/push-sw.js' }, null, 2).replace(/</g, '\\u003c');
  const sdkUrl = JSON.stringify(`${details.api_base}/sdk/push.js`).replace(/</g, '\\u003c');
  const snippet = `<script>\nwindow.pushConfig = ${publicConfig};\n(function (d) {\n  var s = d.createElement('script');\n  s.src = ${sdkUrl};\n  s.async = true;\n  d.head.appendChild(s);\n})(document);\n</script>`;

  return <>
    <section className="configuration-card configuration-summary" aria-label="Website configuration keys">
      <dl><div><dt>Website:</dt><dd>{details.domain_name}</dd></div><div><dt>Domain Key:</dt><dd>{details.domain_key}</dd></div><div><dt>VAPID Public Key:</dt><dd>{details.vapid_public_key}</dd></div></dl>
    </section>

    <section className="configuration-card configuration-install" aria-labelledby="configuration-push-heading">
      <nav className="configuration-subtabs" aria-label="Integration options">
        <button className="is-active" aria-current="page">Push Notification</button>
        {['Pop ups', 'After Sale Feedback', 'Android Setting', 'iOS Setting'].map(label => <button key={label} disabled title="Not available yet">{label}</button>)}
      </nav>
      <h1 id="configuration-push-heading">Push Notification</h1>
      {!details.live_ready && <p className="configuration-local-note" role="status">This API is configured for local testing. A public HTTPS API address is needed to connect a live website.</p>}

      <div className="configuration-accordions">
        <div className="configuration-accordion">
          <button type="button" id="configuration-script-toggle" className="configuration-install-toggle" aria-expanded={openInstall === 'script'} aria-controls="configuration-script-content" onClick={() => { setOpenInstall(value => value === 'script' ? '' : 'script'); setCopyStatus(''); }}>
            <span className="configuration-script-icon" aria-hidden="true">{'</>'}</span><span>Install With Script</span><Chevron open={openInstall === 'script'} />
          </button>
          <div id="configuration-script-content" role="region" aria-labelledby="configuration-script-toggle" hidden={openInstall !== 'script'}>
            {openInstall === 'script' && <div className="configuration-install-content">
              <p>For websites managed without WordPress, add this snippet to your website’s <code>&lt;head&gt;</code>.</p>
              <pre className="configuration-code"><code>{snippet}</code></pre>
              <button type="button" className="configuration-copy" onClick={() => copy(snippet, 'Script')}>Copy script</button>
              <ol><li>Download the service worker and upload it as <code>/push-sw.js</code> on your website.</li><li>Publish the snippet, visit your website, and click Enable notifications.</li><li>Allow browser notifications, then send a test using the form below.</li></ol>
              <a className="configuration-download" href={`${API_BASE}/push-sw.js`} download>Download push-sw.js</a>
            </div>}
          </div>
        </div>
        <div className="configuration-accordion">
          <button type="button" id="configuration-wordpress-toggle" className="configuration-install-toggle" aria-expanded={openInstall === 'wordpress'} aria-controls="configuration-wordpress-content" onClick={() => { setOpenInstall(value => value === 'wordpress' ? '' : 'wordpress'); setCopyStatus(''); setShowSender(false); }}>
            <span className="configuration-wordpress-icon" aria-hidden="true">W</span><span>Install WordPress Plugin</span><Chevron open={openInstall === 'wordpress'} />
          </button>
          <div id="configuration-wordpress-content" role="region" aria-labelledby="configuration-wordpress-toggle" hidden={openInstall !== 'wordpress'}>
            {openInstall === 'wordpress' && <div className="configuration-install-content">
              <p className="configuration-recommended">Recommended for your WordPress website</p>
              <ol><li>Download the plugin ZIP below.</li><li>In WordPress, open Plugins → Add New Plugin → Upload Plugin. Upload the ZIP and activate it.</li><li>Open Settings → Push Notifications and copy these values.</li></ol>
              <dl className="configuration-wordpress-values">
                {[
                  ['API Base', details.api_base], ['Service URL', details.service_url], ['Domain Key', details.domain_key], ['VAPID Public Key', details.vapid_public_key],
                ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code><button type="button" className="configuration-copy" onClick={() => copy(value, label)} aria-label={`Copy ${label}`}>Copy</button></dd></div>)}
                <div><dt><label htmlFor="configuration-sender-key">Sender API Key</label></dt><dd className="configuration-sender-field"><input id="configuration-sender-key" type={showSender ? 'text' : 'password'} value={details.sender_api_key || ''} readOnly autoComplete="off" /><button type="button" className="configuration-copy" aria-pressed={showSender} onClick={() => setShowSender(value => !value)}>{showSender ? 'Hide' : 'Show'}</button><button type="button" className="configuration-copy" onClick={() => copy(details.sender_api_key, 'Sender API Key')} aria-label="Copy Sender API Key">Copy</button></dd></div>
              </dl>
              <p>Leave Service Worker Path empty to use the bundled worker. Save settings, visit your website, click Enable notifications, and choose Allow.</p>
              <p>The plugin installs the script automatically. Keep the Sender API Key in WordPress settings; it is not part of the visitor script.</p>
              <p>Enable Send on publish in WordPress if you want notifications for new posts.</p>
              <a className="configuration-download" href={`${API_BASE}/downloads/push-notifications-plugin.zip?v=1.1.1`} download>Download WordPress Plugin</a>
            </div>}
          </div>
        </div>
        {copyStatus && <p className="configuration-copy-status" role="status">{copyStatus}</p>}
      </div>
    </section>

    <section className="configuration-card configuration-send" id="send-push" aria-labelledby="configuration-test-heading">
      <h2 id="configuration-test-heading">Send a test notification</h2><p>This sends to all subscribers of this website. Subscribe from your website first.</p>
      <form onSubmit={sendTest}>
        <div className="configuration-field"><label htmlFor="test-title">Title</label><input id="test-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={150} disabled={sending} /></div>
        <div className="configuration-field"><label htmlFor="test-body">Message</label><input id="test-body" value={body} onChange={event => setBody(event.target.value)} maxLength={1000} disabled={sending} /></div>
        <div className="configuration-field"><label htmlFor="test-url">Link (optional)</label><input id="test-url" value={url} onChange={event => setUrl(event.target.value)} placeholder={`https://${details.domain_name}/`} disabled={sending} /></div>
        <button className="configuration-send-button" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send test notification'}</button>
        {sendResult && <p className={sendError ? 'configuration-error' : 'configuration-success'} role={sendError ? 'alert' : 'status'}>{sendResult}</p>}
      </form>
    </section>
  </>;
}
