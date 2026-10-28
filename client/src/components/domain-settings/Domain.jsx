import React, { useEffect, useState } from 'react';
import './domain.css';

// Domain setup layout aligned to the provided screenshot.
// After validation, we call the backend to persist the domain and then route to SiteSelect/Config tab.
import { API_BASE, apiFetch } from '../../api';

const Domain = ({
  onLogout = () => {},
  onSettings = () => {},
  onSiteSelect = () => {},
  onDashboard = () => {},
  onSelectDomainTab = () => {},
  selectedDomainKey = '',
  selectedDomainName = '',
  defaultTab = 'domain',
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultTab);
  // Config details loaded from API when viewing Configuration tab.
  const [configDetails, setConfigDetails] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  // Toggle states for showing code/plugin details under each config card.
  const [showScript, setShowScript] = useState(false);
  const [showPlugin, setShowPlugin] = useState(true);
  const [testTitle, setTestTitle] = useState('Test notification');
  const [testBody, setTestBody] = useState('Push notifications are connected.');
  const [testUrl, setTestUrl] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testError, setTestError] = useState(false);
  // Domain list for the navbar dropdown.
  const [domains, setDomains] = useState([]);
  const [dropdownValue, setDropdownValue] = useState(selectedDomainName || 'add');

  // Sync tab when parent requests a specific default tab.
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  // Fetch all domains so the navbar dropdown can list them.
  useEffect(() => {
    const loadDomains = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/domains?userId=1`);
        const data = await res.json();
        if (res.ok && data.ok && Array.isArray(data.data)) {
          setDomains(
            data.data.map((d) => ({
              name: d.domain_name || d.domain,
              key: d.domain_key,
            })),
          );
        }
      } catch (e) {
        // Silent fail for navbar list; form still works.
      }
    };
    loadDomains();
  }, []);

  // Keep dropdown selection in sync when parent passes a new domain.
  useEffect(() => {
    if (selectedDomainName) {
      setDropdownValue(selectedDomainName);
    }
  }, [selectedDomainName]);

  // Keep URL in sync with tab selection (mimic Feedify URLs).
  useEffect(() => {
    if (activeTab === 'config' && selectedDomainKey) {
      // Preserve the composer anchor when opening Configuration from the overview.
      const url = `/settings/config?domain=${encodeURIComponent(selectedDomainKey)}`;
      if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url);
    } else if (activeTab === 'domain') {
      window.history.pushState({}, '', '/settings/domain');
    }
  }, [activeTab, selectedDomainKey]);

  useEffect(() => {
    if (configDetails && activeTab === 'config' && window.location.hash === '#send-push') {
      document.getElementById('send-push')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      document.getElementById('test-title')?.focus({ preventScroll: true });
    }
  }, [configDetails, activeTab]);

  // Fetch configuration details (including VAPID public key) when config tab is active.
  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      if (activeTab !== 'config' || !selectedDomainKey) return;
      setConfigLoading(true);
      setConfigDetails(null);
      setTestResult('');
      setConfigError('');
      try {
        const res = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(selectedDomainKey)}/integration`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Failed to load configuration');
        }
        if (!cancelled) setConfigDetails(data.data);
      } catch (err) {
        if (!cancelled) setConfigError(err.message || 'Error loading configuration');
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    };
    loadConfig();
    return () => { cancelled = true; };
  }, [activeTab, selectedDomainKey]);

  // Build a personalized script snippet for the current domain (rendered in the Config tab).
  const domainKeyForSnippet = configDetails?.domain_key || selectedDomainKey || '<your-domain-key>';
  const vapidKeyForSnippet = configDetails?.vapid_public_key || '<vapid-public-key>';
  const apiBaseForSnippet = configDetails?.api_base || API_BASE;
  const snippetText = `<!-- Push Script -->
<script>
  (function (d, w) {
    // Per-domain config passed to the SDK
    w.pushConfig = {
      domainKey: '${domainKeyForSnippet}',
      apiBase: '${apiBaseForSnippet}',
      vapidPublicKey: '${vapidKeyForSnippet}',
      swPath: '/push-sw.js' // Change if you host the service worker elsewhere
    };
    // Load your hosted SDK
    var s = d.createElement('script');
    s.src = '${apiBaseForSnippet}/sdk/push.js';
    s.async = true;
    d.head.appendChild(s);
  })(document, window);
</script>`;

  // Download URL for the WordPress plugin zip (place the zip in /public/downloads/).
  const pluginDownloadUrl = `${API_BASE}/downloads/push-notifications-plugin.zip?v=1.1.1`;

  const sendTest = async (event) => {
    event.preventDefault();
    setSendingTest(true);
    setTestResult('');
    setTestError(false);
    try {
      const response = await apiFetch(`${API_BASE}/api/notifications`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_key: selectedDomainKey, title: testTitle, body: testBody, url: testUrl || '/' }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not send the test notification.');
      setTestResult(result.message);
    } catch (error) {
      setTestError(true);
      setTestResult(error.message);
    } finally { setSendingTest(false); }
  };

  const handleSiteChange = (e) => {
    const value = e.target.value;
    setDropdownValue(value);
    // If "Add Domain +" is chosen, jump to Domain tab for adding.
    if (value === 'add') {
      setActiveTab('domain');
      onSelectDomainTab('domain');
      window.history.pushState({}, '', '/settings/domain');
      return;
    }

    // For an existing domain selection, find its key and switch to Configuration.
    const chosen = domains.find((d) => d.name === value);
    if (chosen) {
      onSiteSelect(chosen.key, chosen.name); // update parent selection
      setActiveTab('config');
      onSelectDomainTab('config');
      window.history.pushState({}, '', `/settings/config?domain=${encodeURI(chosen.key)}`);
    }
  };

  // Validate inputs and run mock technical checks.
  const runValidation = () => {
    const nextErrors = {};

    // Basic: name required
    if (!name.trim()) {
      nextErrors.name = 'Name is required.';
    }

    // Basic: domain required
    if (!domain.trim()) {
      nextErrors.domain = 'Domain is required.';
    }

    // Format: simple domain regex (example.com, no protocol here)
    const domainRegex = /^(?!-)([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,}$/;
    if (domain && !domainRegex.test(domain.trim())) {
      nextErrors.domain = 'Enter a valid domain like example.com';
    }

    // Mock duplicate checks: pretend these domains already exist
    const existingDomains = ['example.com', 'demo.com'];
    if (existingDomains.includes(domain.trim().toLowerCase())) {
      nextErrors.domain = 'This domain is already registered.';
    }

    // Mock reachability check: pretend that any domain ending with ".invalid" fails
    if (domain.endsWith('.invalid')) {
      nextErrors.domain = 'Domain does not appear reachable (mock check).';
    }

    // Mock duplicate-in-system check (same as above, illustrative)
    const duplicateInSystem = ['mysite.com'];
    if (duplicateInSystem.includes(domain.trim().toLowerCase())) {
      nextErrors.domain = 'Domain is duplicated in the system.';
    }

    setErrors(nextErrors);
    return nextErrors;
  };

  const handleSave = async () => {
    setStatus('');
    const nextErrors = runValidation();
    if (Object.keys(nextErrors).length > 0) return;

    // If everything passes, call backend and navigate to site selection.
    setLoading(true);
    setStatus('Domain looks good. Saving...');

    try {
      const response = await apiFetch(`${API_BASE}/api/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 1, // replace with real user/account id when available
          name,
          domain_name: domain.toLowerCase(),
          timezone: '(GMT+05:30) Asia, Kolkata',
        }),
      });

      // Try to read JSON; if backend is down or returning HTML, show a clear message.
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Backend did not return JSON. Is the API running on ' + API_BASE + '?');
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Failed to save domain.');
      }

      setStatus('Domain saved. Redirecting to site selection...');
      // Give the user a moment to see the message, then show SiteSelect/Config.
      setTimeout(() => {
        setLoading(false);
        const domainKey = data.data?.domain_key;
        const domainName = data.data?.domain_name || domain;
        onSiteSelect(domainKey, domainName);
      }, 600);
    } catch (err) {
      setLoading(false);
      setStatus(err.message || 'Save failed.');
    }
  };

  return (
    <div className="domain-page">
      <header className="domain-hero">
        <div className="brand">
          <div className="logo">
            <img src="/images/TTWLogo.jpg" alt="TTW Logo" />
          </div>
          <div className="site-select">
            {/* Navbar domain selector shows all domains plus the add option */}
            <select value={dropdownValue} onChange={handleSiteChange}>
              <option value="add">Add Domain +</option>
              {domains.map((d) => (
                <option key={d.key || d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="nav-actions">
          <button type="button" className="top-nav-btn" onClick={onDashboard}>Dashboard</button>
          <button type="button" className="top-nav-btn" onClick={() => {
            setActiveTab('config'); onSelectDomainTab('config');
            window.location.hash = 'send-push';
            document.getElementById('send-push')?.scrollIntoView?.({ behavior: 'smooth' });
          }}>Push Notification</button>
          <div className="top-nav-btn">Report</div>
          <div className="top-nav-btn badge">Newsroll</div>
          <div className="top-nav-btn badge">Newsbox</div>
          <div className="top-nav-btn">More ▼</div>
        </div>
        <div className="top-right">
          <span>Support</span>
          <span className="icon" role="img" aria-label="notifications">🔔</span>
          <div className="profile">
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setShowMenu((open) => !open)}
            >
              <span className="icon" role="img" aria-label="profile">👤</span>
              <span className="caret">▼</span>
            </button>
            {showMenu && (
              <div className="profile-menu">
                <button type="button" className="menu-item" onClick={onSettings}>
                  <span className="menu-icon" role="img" aria-label="settings">⚙️</span> Setting
                </button>
                <div className="menu-sep" />
                <button type="button" className="menu-item" onClick={onLogout}>
                  <span className="menu-icon" role="img" aria-label="logout">↩️</span> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="domain-content">
        <nav className="tabs">
          <button className="tab">Settings</button>
          <button
            className={`tab ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('config');
              onSelectDomainTab('config');
            }}
          >
            Configuration
          </button>
          <button
            className={`tab ${activeTab === 'domain' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('domain');
              onSelectDomainTab('domain');
            }}
          >
            Domain
          </button>
          <button className="tab">Account</button>
          <button className="tab">User</button>
        </nav>

        {activeTab === 'domain' && (
          <section className="form-card">
            <div className="field">
              <label>
                Name <span className="required">*</span>
              </label>
              <input
                type="text"
                placeholder=""
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <div className="error">{errors.name}</div>}
            </div>

            <div className="field">
              <label>
                Domain <span className="required">*</span>
              </label>
              <div className="domain-input">
                <div className="prefix">https:// or http://</div>
                <input
                  type="text"
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
              {errors.domain && <div className="error">{errors.domain}</div>}
            </div>

            <div className="field">
              <label>Time Zone</label>
              <select defaultValue="(GMT+05:30) Asia, Kolkata">
                <option>(GMT+05:30) Asia, Kolkata</option>
                <option>(GMT+05:30) Asia, Kolkata (Assam)</option>
                <option>(GMT+05:30) Asia, Kolkata (Guwahati)</option>
                <option>(GMT-05:00) America, New York</option>
              </select>
            </div>

            <div className="actions">
              <button type="button" className="save-btn" disabled={loading} onClick={handleSave}>
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>

            {status && <div className="success">{status}</div>}
            {loading && <div className="spinner">Saving domain...</div>}
          </section>
        )}

        {activeTab === 'config' && (
          <section className="form-card config-pane">
            <h3>Configuration</h3>
            {configLoading && <div className="spinner">Loading configuration...</div>}
            {configError && <div className="error">{configError}</div>}
            {!configLoading && !configError && configDetails && (
              <>
                <div className="config-keys">
                  <div className="key-row">
                    <span className="label">Domain Name:</span>
                    <span className="value">
                      {configDetails?.domain_name || selectedDomainName || '—'}
                    </span>
                  </div>
                  <div className="key-row">
                    <span className="label">Domain Key:</span>
                    <span className="value">
                      {configDetails?.domain_key || selectedDomainKey || '—'}
                    </span>
                  </div>
                  <div className="key-row">
                    <span className="label">VAPID Public Key:</span>
                    <span className="value">
                      {configDetails?.vapid_public_key || '—'}
                    </span>
                  </div>
                </div>

                {!configDetails.live_ready && (
                  <p className="setup-notice" role="status">
                    Local testing is configured. To connect your live WordPress site, deploy the API with HTTPS
                    and set its public address as PUBLIC_API_BASE on the server. The installation settings below
                    will then use that address.
                  </p>
                )}

                <div className="config-tabs">
                  <button className="subtab active">Push Notification</button>
                  <button className="subtab">Pop ups</button>
                  <button className="subtab">After Sale Feedback</button>
                  <button className="subtab">Android Setting</button>
                  <button className="subtab">IOS Setting</button>
                </div>

                  <div className="config-section">
                    <div className="config-section-header">
                      <h4>Push Notification</h4>
                    </div>
                    <div className="config-cards">
                      <div className="config-card-item">
                        <div className="config-card-title-row">
                          <div className="config-card-title">Install With Script</div>
                          <button
                            type="button"
                            className={`toggle-arrow ${showScript ? 'open' : ''}`}
                            onClick={() => {
                              // Only this card opens; close WP card for a cleaner UX.
                              setShowScript(!showScript);
                              setShowPlugin(false);
                            }}
                            aria-label="Toggle script details"
                          >
                            ▼
                          </button>
                        </div>
                        {/* Animated collapse for script details */}
                        <div style={{ maxHeight: showScript ? '700px' : '0px', opacity: showScript ? 1 : 0, overflow: 'hidden', transition: 'all 0.35s ease' }}>
                          {showScript && (
                            <div className="code-block">
                              <p className="code-step">
                                {/* Tell the user where to place the snippet */}
                                Step 1: Copy this snippet into the <code>&lt;head&gt;</code> of your site.
                              </p>
                              <pre className="code-snippet">{snippetText}</pre>
                              <p className="code-step">
                                Step 2: Ensure <code>push-sw.js</code> is reachable at the configured <code>swPath</code> (root recommended).
                              </p>
                              <p className="code-step">
                                Step 3: Publish the site and send a test push from your dashboard.
                              </p>
                              <p className="code-step">
                                {/* Allow users to download the service worker file directly (mirrors Feedify style) */}
                                <a href={`${API_BASE}/push-sw.js`} download>
                                  Download push-sw.js
                                </a>
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="config-card-item">
                        <div className="config-card-title-row">
                          <div className="config-card-title">Install WordPress Plugin (recommended for WordPress)</div>
                            <button
                            type="button"
                            className={`toggle-arrow ${showPlugin ? 'open' : ''}`}
                            onClick={() => {
                              // Only this card opens; close Script card for a cleaner UX.
                              setShowPlugin(!showPlugin);
                              setShowScript(false);
                            }}
                            aria-label="Toggle plugin details"
                          >
                            ▼
                          </button>
                        </div>
                        {/* Animated collapse for plugin details */}
                        <div hidden={!showPlugin}>
                          {showPlugin && (
                            <div className="config-card-desc">
                              <ol>
                                <li>Download the plugin below.</li>
                                <li>In WordPress, open Plugins → Add New Plugin → Upload Plugin, upload the ZIP, and activate it.</li>
                                <li>Open Settings → Push Notifications and copy these settings.</li>
                              </ol>
                              <dl className="wordpress-settings">
                                <dt>API Base</dt><dd>{configDetails.api_base}</dd>
                                <dt>Service URL</dt><dd>{configDetails.service_url}</dd>
                                <dt>Domain Key</dt><dd>{configDetails.domain_key}</dd>
                                <dt>VAPID Public Key</dt><dd>{configDetails.vapid_public_key}</dd>
                                <dt>Sender API Key</dt>
                                <dd><input aria-label="Sender API Key" readOnly value={configDetails.sender_api_key || ''} /></dd>
                              </dl>
                              <p>The Sender API Key belongs only in WordPress settings. The plugin keeps it out of visitor scripts.</p>
                              <p>Leave Service Worker Path empty to use the bundled worker. Save settings, visit your website, and click Enable notifications.</p>
                              <p>The plugin installs the script automatically. Enable Send on publish if you want notifications for new posts.</p>
                              <p className="code-step">
                                <a href={pluginDownloadUrl} download>
                                  Download WordPress Plugin
                                </a>
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                </div>
                <form className="config-section" id="send-push" onSubmit={sendTest}>
                  <h4>Send a test notification</h4>
                  <p>This sends to all subscribers of this website. Subscribe from your website first.</p>
                  <div className="field">
                    <label htmlFor="test-title">Title</label>
                    <input id="test-title" value={testTitle} onChange={event => setTestTitle(event.target.value)} required maxLength={150} />
                  </div>
                  <div className="field">
                    <label htmlFor="test-body">Message</label>
                    <input id="test-body" value={testBody} onChange={event => setTestBody(event.target.value)} maxLength={1000} />
                  </div>
                  <div className="field">
                    <label htmlFor="test-url">Link (optional)</label>
                    <input id="test-url" value={testUrl} onChange={event => setTestUrl(event.target.value)} placeholder={`https://${configDetails.domain_name}/`} />
                  </div>
                  <button className="save-btn" type="submit" disabled={sendingTest}>{sendingTest ? 'Sending...' : 'Send test notification'}</button>
                  {testResult && <p role="status" className={testError ? 'error' : 'success'}>{testResult}</p>}
                </form>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default Domain;
