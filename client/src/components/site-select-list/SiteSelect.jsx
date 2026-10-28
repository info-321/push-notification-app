import React, { useEffect, useState } from 'react';
import './siteselect.css';

import { API_BASE, apiFetch } from '../../api';

// Site selection list, fetched from backend domains endpoint.
// Enhancements: per-card 3-dot menu (Edit/Delete), domain dropdown with "Add Domain", and profile dropdown.
const SiteSelect = ({
  onAddDomain,
  onSettings,
  onManageDomains,
  onLogout,
  onSelectDomain,
  onEditDomain = () => {},
}) => {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [openMenuFor, setOpenMenuFor] = useState(null); // which domain card menu is open
  const [deletingKey, setDeletingKey] = useState(null); // deletion state

  // Fetch domains from backend
  useEffect(() => {
    const fetchDomains = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await apiFetch(`${API_BASE}/api/domains?userId=1`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to load domains');
        }
        // Push installation status comes from the API, not ownership verification.
        const list = (data.data || []).map((d) => ({
          id: d.id,
          name: d.domain_name || d.domain,
          configured: d.is_configured === true,
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
    const chosen = domains.find(domain => domain.name === value);
    if (chosen) onSelectDomain?.(chosen.key, chosen.name);
  };

  // Delete a domain on the backend and remove from UI
  const handleDeleteDomain = async (domain) => {
    if (!domain?.id && !domain?.key) return;
    const ok = window.confirm(`Delete ${domain.name}? This cannot be undone.`);
    if (!ok) return;
    setDeletingKey(domain.key || domain.id);
    try {
      // Prefer numeric id path; fallback to domain_key query if id missing. Use userId for API consistency.
      const url = domain.id
        ? `${API_BASE}/api/domains/${encodeURIComponent(domain.id)}?userId=1`
        : `${API_BASE}/api/domains?userId=1&domain_key=${encodeURIComponent(domain.key)}`;

      const res = await apiFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Failed to delete domain (status ${res.status})`);
      }

      setDomains((prev) => prev.filter((d) => d.id !== domain.id && d.key !== domain.key));
      setOpenMenuFor(null);
    } catch (err) {
      alert(err.message || 'Error deleting domain');
    } finally {
      setDeletingKey(null);
    }
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
            <select value={selectedDomain} onChange={handleDomainSelect} aria-label="Select domain or add a domain">
              {!selectedDomain && <option value="" disabled>Select a domain</option>}
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
                <button type="button" className="menu-item" onClick={onManageDomains}>Domains</button>
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
                <button type="button" className="domain-info domain-open" onClick={() => onSelectDomain?.(item.key, item.name)} aria-label={`Open dashboard for ${item.name}`}>
                  <span className="domain-name">{item.name}</span>
                  <span
                    className={`domain-status ${item.configured ? 'ok' : 'pending'}`}
                    title={item.configured
                      ? 'Browser notifications have been enabled for this website.'
                      : 'Finish setup and enable notifications on your website.'}
                  >
                    {item.configured ? 'Configured' : 'Not Configured'}
                  </span>
                </button>
                <div className="card-actions">
                  {/* 3-dot menu trigger; toggles a simple menu with Edit/Delete */}
                  <button
                    type="button"
                    className="menu-trigger"
                    aria-label="Open domain menu"
                    onClick={() => setOpenMenuFor(openMenuFor === item.name ? null : item.name)}
                  >
                    ⋮
                  </button>
                  {openMenuFor === item.name && (
                    <div className="card-menu">
                      <button
                        type="button"
                    className="card-menu-item"
                    onClick={() => {
                      onEditDomain(item); // pass domain to edit handler
                      setOpenMenuFor(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="card-menu-item"
                    onClick={() => handleDeleteDomain(item)}
                    disabled={deletingKey === item.key}
                  >
                    {deletingKey === item.key ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
                  <button
                    type="button"
                    className="domain-action"
                    aria-label="Open domain"
                    onClick={() => onSelectDomain?.(item.key, item.name)}
                  >
                    →
                  </button>
                </div>
              </div>
            ))}
            {domains.length === 0 && (
              <div className="empty">
                <p>No domains yet. Add one to get started.</p>
                <button type="button" className="primary-btn" onClick={onAddDomain}>
                  Add Domain
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SiteSelect;
