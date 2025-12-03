import React, { useEffect, useState } from 'react';
import './configuration.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5000';

// Configuration screen that reads ?domain=<domain_key>, fetches domain details,
// and displays domain key + VAPID public key placeholders similar to Feedify.
const Configuration = ({ domainKey, domainName, onLogout, onSettings, onBackToSites }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(null);

  useEffect(() => {
    // Use domainKey from prop or URL query param if not provided.
    let key = domainKey;
    if (!key) {
      const params = new URLSearchParams(window.location.search);
      key = params.get('domain');
    }
    if (!key) {
      setError('No domain selected.');
      setLoading(false);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/api/domains/${encodeURIComponent(key)}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Failed to load domain');
        }
        setDetails(data.data);
      } catch (err) {
        setError(err.message || 'Error loading domain');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [domainKey]);

  return (
    <div className="config-page">
      <header className="config-hero">
        <div className="config-brand">
          <div className="logo">TTW</div>
          <div className="config-title">Configuration</div>
        </div>
        <div className="config-actions">
          <span className="support">Support</span>
          <div className="profile">
            <button type="button" className="profile-trigger" onClick={onSettings}>
              <span role="img" aria-label="settings">
                ⚙️
              </span>
            </button>
            <button type="button" className="profile-trigger" onClick={onLogout}>
              <span role="img" aria-label="logout">
                ↩️
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="config-card">
        <div className="tabs">
          <button className="tab active">Configuration</button>
          <button className="tab" onClick={onBackToSites}>
            Domain
          </button>
        </div>

        {loading && <div className="spinner">Loading configuration...</div>}
        {error && <div className="error">{error}</div>}

        {!loading && !error && details && (
          <div className="config-body">
            <div className="config-keys">
              <div className="key-row">
                <span className="label">Domain Name:</span>
                <span className="value">{details.domain_name || domainName || '—'}</span>
              </div>
              <div className="key-row">
                <span className="label">Domain Key:</span>
                <span className="value">{details.domain_key || '—'}</span>
              </div>
              <div className="key-row">
                <span className="label">VAPID Public Key:</span>
                <span className="value">{details.vapid_public_key || '—'}</span>
              </div>
            </div>

            <div className="config-tabs">
              <button className="subtab active">Push Notification</button>
              <button className="subtab">Pop ups</button>
              <button className="subtab">After Sale Feedback</button>
              <button className="subtab">Android Setting</button>
              <button className="subtab">IOS Setting</button>
            </div>

            <div className="config-section">
              <h3>Push Notification</h3>
              <p>Install with script, install WordPress plugin, or integrate with your app.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Configuration;
