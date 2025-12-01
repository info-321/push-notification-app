import React, { useState } from 'react';
import './domain.css';

// Domain setup layout aligned to the provided screenshot.
// After validation, we call the backend to persist the domain and then route to SiteSelect.
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5000';

const Domain = ({ onLogout = () => {}, onSettings = () => {}, onSiteSelect = () => {} }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSiteChange = (e) => {
    // If "Add Domain +" is chosen, stay on this page so user can add domains.
    if (e.target.value === 'add') {
      window.location.href = window.location.pathname;
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
      const response = await fetch(`${API_BASE}/api/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: 1, // replace with real user/account id when available
          name,
          domain: domain.toLowerCase(),
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
      // Give the user a moment to see the message, then show SiteSelect (which fetches domains).
      setTimeout(() => {
        setLoading(false);
        onSiteSelect();
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
            <select defaultValue="add" onChange={handleSiteChange}>
              <option value="add">Add Domain +</option>
              {/* <option value="www.travelandtourworld.ee">www.travelandtourworld.ee</option> */}
            </select>
          </div>
        </div>
        <div className="nav-actions">
          <div className="top-nav-btn">Dashboard</div>
          <div className="top-nav-btn">Push Notification</div>
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
          <button className="tab">Configuration</button>
          <button className="tab active">Domain</button>
          <button className="tab">Account</button>
          <button className="tab">User</button>
        </nav>

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
          {loading && <div className="spinner">Checking DNS/HTTP and saving...</div>}
        </section>
      </div>
    </div>
  );
};

export default Domain;
