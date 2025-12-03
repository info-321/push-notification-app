import React, { useEffect, useState } from 'react';
import './siteselect.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5000';

// Site selection list, fetched from backend domains endpoint.
// Enhancements: domain dropdown with "Add Domain" option, profile dropdown, and clicking a domain arrow opens Configuration.
const SiteSelect = ({ onAddDomain, onSettings, onLogout, onSelectDomain }) => {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Fetch domains from backend
  useEffect(() => {
    const fetchDomains = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/api/domains?ownerId=1`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to load domains');
        }
        // Normalize status to boolean configured flag for UI
        const list = (data.data || []).map((d) => ({
          name: d.domain_name || d.domain,
          configured: d.status === 'verified',
          key: d.domain_key,
        }));
        setDomains(list);
        if (list.length > 0) {
          setSelectedDomain(list[0].name);
        }
      } catch (err) {
        setError(err.message || 'Error loading domains');
      } finally {
        setLoading(false);
      }
    };
    fetchDomains();
  }, []);

  const handleDomainSelect = (e) => {
    const value = e.target.value;
    if (value === 'add') {
      // Route to Domain page to add a new domain
      onAddDomain?.();
      return;
    }
    setSelectedDomain(value);
  };

  return (
    <div className="sites-page">
      <header className="sites-hero">
        <div className="brand">
          <div className="logo">
            <img src="/images/TTWLogo.jpg" alt="TTW Logo" />
          </div>
          <div className="site-select">
            {/* Domain selector with "Add Domain" option */}
            <select value={selectedDomain || 'add'} onChange={handleDomainSelect}>
              <option value="add">Add Domain +</option>
              {domains.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="top-right">
          <span>Support</span>
          <span className="icon" role="img" aria-label="bell">
            🔔
          </span>
          <div className="profile">
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setShowProfileMenu((open) => !open)}
            >
              <span className="icon" role="img" aria-label="profile">
                👤
              </span>
              <span className="caret">▼</span>
            </button>
            {showProfileMenu && (
              <div className="profile-menu">
                <button type="button" className="menu-item" onClick={onSettings}>
                  <span className="menu-icon" role="img" aria-label="settings">
                    ⚙️
                  </span>{' '}
                  Setting
                </button>
                <div className="menu-sep" />
                <button type="button" className="menu-item" onClick={onLogout}>
                  <span className="menu-icon" role="img" aria-label="logout">
                    ↩️
                  </span>{' '}
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="sites-card">
        <div className="sites-header">
          <h1>Select Domain</h1>
        </div>

        {loading && <div className="spinner">Loading domains...</div>}
        {error && <div className="error">Error: {error}</div>}

        {!loading && !error && (
          <div className="domains-grid">
            {domains.map((item) => (
              <div className="domain-card" key={item.name}>
                <div className="domain-info">
                  <div className="domain-name">{item.name}</div>
                  <div className={`domain-status ${item.configured ? 'ok' : 'pending'}`}>
                    {item.configured ? 'Configured' : 'Not Configured'}
                  </div>
                </div>
                <button
                  type="button"
                  className="domain-action"
                  aria-label="Open domain"
                  onClick={() => onSelectDomain?.(item.key, item.name)}
                >
                  →
                </button>
              </div>
            ))}
            {domains.length === 0 && <div className="empty">No domains yet. Add one to get started.</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default SiteSelect;
