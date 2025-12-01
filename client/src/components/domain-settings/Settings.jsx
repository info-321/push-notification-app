import React from 'react';
import './settings.css';

const Settings = ({ onBack, onLogout }) => {
  return (
    <div className="settings-page">
      <div className="settings-card">
        <div className="settings-header">
          <h1>Settings</h1>
          <div className="settings-actions">
            {onBack && (
              <button type="button" className="ghost-btn" onClick={onBack}>
                Back to Domain
              </button>
            )}
            {onLogout && (
              <button type="button" className="primary-btn" onClick={onLogout}>
                Logout
              </button>
            )}
          </div>
        </div>
        <p>Settings page placeholder. Add your settings forms here.</p>
      </div>
    </div>
  );
};

export default Settings;
