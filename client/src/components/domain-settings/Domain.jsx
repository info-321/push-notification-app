import React from 'react';
import './domain.css';

// Domain setup layout aligned to the provided screenshot.
const Domain = () => {
  const handleSiteChange = (e) => {
    // If "Add Domain +" is chosen, stay on this page so user can add domains.
    if (e.target.value === 'add') {
      window.location.href = window.location.pathname;
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
          <span className="icon">🔔</span>
          <span className="icon">👤</span>
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
            <input type="text" placeholder="" />
          </div>

          <div className="field">
            <label>
              Domain <span className="required">*</span>
            </label>
            <div className="domain-input">
              <div className="prefix">https:// or http://</div>
              <input type="text" placeholder="example.com" />
            </div>
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
            <button type="button" className="save-btn">
              Save
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Domain;
