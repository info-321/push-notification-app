import React, { useEffect, useState } from 'react';
import './domain.css';
import './domain-list.css';
import ConfigurationPanel from './ConfigurationPanel';

// Domain setup layout aligned to the provided screenshot.
// After validation, we call the backend to persist the domain and then route to SiteSelect/Config tab.
import { API_BASE, apiFetch } from '../../api';
import { timeZones } from './timezones';

const Domain = ({
  onLogout = () => {},
  onSettings = () => {},
  onAccount = () => {},
  onSiteSelect = () => {},
  onDashboard = () => {},
  onDomains = () => {},
  onSelectDomainTab = () => {},
  selectedDomainKey = '',
  selectedDomainName = '',
  defaultTab = 'domain',
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Kolkata');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultTab);
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

  // Direct configuration links restore the selected website after the list loads.
  useEffect(() => {
    if (activeTab === 'domain') { setDropdownValue('add'); return; }
    const chosen = domains.find(item => item.key === selectedDomainKey);
    setDropdownValue(chosen?.name || selectedDomainName || 'add');
  }, [domains, selectedDomainKey, selectedDomainName, activeTab]);

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

  // Validate the new website before submitting it.
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
          time_zone: timeZone,
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
    <div className={activeTab === 'config' ? 'domain-list-page configuration-screen' : 'domain-page'}>
      {activeTab === 'config' ? (
        <header className="domain-list-header">
          <div className="domain-list-brand">
            <button type="button" className="domain-list-logo" aria-label="Website dashboard" onClick={onDashboard}><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
            <select aria-label="Select website" value={dropdownValue} onChange={handleSiteChange}>
              <option value="add">Add Domain +</option>
              {domains.map(item => <option value={item.name} key={item.key}>{item.name}</option>)}
            </select>
          </div>
          <div className="domain-list-account"><button type="button" className="domain-list-dashboard-link" onClick={onDashboard}>Dashboard</button>
            <div className="domain-list-profile"><button type="button" className="domain-list-profile-trigger" aria-label="Account menu" aria-expanded={showMenu} onClick={() => setShowMenu(value => !value)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M5 19c1-6 13-6 14 0" /></svg><span aria-hidden="true">&#8964;</span>
            </button>{showMenu && <div className="domain-list-profile-menu"><button onClick={onSettings}>Settings</button><button onClick={onAccount}>Account</button><button onClick={onLogout}>Log out</button></div>}</div>
          </div>
        </header>
      ) : (
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
      )}

      <div className={activeTab === 'config' ? 'domain-list-main configuration-main' : 'domain-content'}>
        {activeTab === 'config' ? (
          <nav className="domain-list-tabs" aria-label="Settings navigation">
            <button onClick={onSettings}>Settings</button><button onClick={onAccount}>Account</button><button className="is-active" aria-current="page">Configuration</button>
            <button onClick={onDomains}>Domain</button>
            <button disabled title="PWA settings are not available yet">PWA Setting</button><button disabled title="User management is not available yet">User</button>
          </nav>
        ) : (
        <nav className="tabs">
          <button className="tab" onClick={onSettings}>Settings</button>
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
              onDomains();
            }}
          >
            Domain
          </button>
          <button className="tab" onClick={onAccount}>Account</button>
          <button className="tab">User</button>
        </nav>
        )}

        {activeTab === 'domain' && (
          <section className="form-card">
            <div className="field">
              <label htmlFor="new-domain-name">
                Name <span className="required">*</span>
              </label>
              <input
                id="new-domain-name"
                type="text"
                maxLength={255}
                placeholder=""
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <div className="error">{errors.name}</div>}
            </div>

            <div className="field">
              <label htmlFor="new-domain-address">
                Domain <span className="required">*</span>
              </label>
              <div className="domain-input">
                <div className="prefix">https:// or http://</div>
                <input
                  id="new-domain-address"
                  type="text"
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
              {errors.domain && <div className="error">{errors.domain}</div>}
            </div>

            <div className="field">
              <label htmlFor="new-domain-time-zone">Time Zone</label>
              <select id="new-domain-time-zone" value={timeZone} onChange={event => setTimeZone(event.target.value)}>
                {timeZones.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </div>

            <div className="actions">
              <button type="button" className="ghost-btn" disabled={loading} onClick={onDomains}>All domains</button>
              <button type="button" className="save-btn" disabled={loading} onClick={handleSave}>
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>

            {status && <div className="success">{status}</div>}
            {loading && <div className="spinner">Saving domain...</div>}
          </section>
        )}

        {activeTab === 'config' && <ConfigurationPanel key={selectedDomainKey} domainKey={selectedDomainKey} onDomains={onDomains} />}
      </div>
    </div>
  );
};

export default Domain;
