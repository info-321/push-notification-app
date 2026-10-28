import React, { useEffect, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './domain-list.css';
import './account.css';

export default function Account({ selectedDomainKey = '', onSelectDomain = () => {}, onSettings = () => {}, onDomains = () => {}, onConfiguration = () => {}, onDashboard = () => {}, onLogout = () => {} }) {
  const [profile, setProfile] = useState(null);
  const [domains, setDomains] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const activeKey = selectedDomainKey || domains[0]?.domain_key || '';
  const domain = domains.find(item => item.domain_key === activeKey);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    const load = async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/account`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load account.');
        if (!cancelled) setProfile(result.data);
      } catch (err) { if (!cancelled) setError(err.message); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    apiFetch(`${API_BASE}/api/domains`).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (!cancelled && result.ok) setDomains(result.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [retry]);

  const changePassword = async event => {
    event.preventDefault();
    setSaveError(''); setMessage('');
    if (newPassword.length < 12 || newPassword.length > 128) { setSaveError('Use 12–128 characters for your new password.'); return; }
    if (newPassword === currentPassword) { setSaveError('Choose a password different from your current password.'); return; }
    setSaving(true);
    const initiatingToken = localStorage.getItem('sessionToken');
    try {
      const response = await apiFetch(`${API_BASE}/api/account/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.token) throw new Error(result.message || 'Could not change your password.');
      if (localStorage.getItem('sessionToken') !== initiatingToken) return;
      localStorage.setItem('sessionToken', result.token);
      setCurrentPassword(''); setNewPassword(''); setShowPassword(false);
      setMessage(result.message);
    } catch (err) { setSaveError(err.message); }
    finally { setSaving(false); }
  };

  let lastLogin = 'Not recorded yet';
  if (profile?.last_login_at) {
    lastLogin = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, ...(domain?.time_zone ? { timeZone: domain.time_zone } : {}) }).format(new Date(profile.last_login_at));
  }

  return <div className="domain-list-page account-screen">
    <header className="domain-list-header">
      <div className="domain-list-brand"><button type="button" className="domain-list-logo" aria-label="All websites" onClick={() => onDashboard()}><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
        <select aria-label="Select website" value={activeKey} disabled={!domains.length || saving} onChange={event => {
          const selected = domains.find(item => item.domain_key === event.target.value);
          if (selected) onSelectDomain(selected.domain_key, selected.domain_name);
        }}>
          {!domain && <option value={activeKey}>Select a website</option>}
          {domains.map(item => <option key={item.domain_key} value={item.domain_key}>{item.domain_name}</option>)}
        </select>
      </div>
      <div className="domain-list-account"><button className="domain-list-dashboard-link" onClick={() => onDashboard(activeKey, domain?.domain_name)}>Dashboard</button>
        <div className="domain-list-profile"><button type="button" className="domain-list-profile-trigger" aria-label="Account menu" aria-expanded={showProfileMenu} onClick={() => setShowProfileMenu(value => !value)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M5 19c1-6 13-6 14 0" /></svg><span aria-hidden="true">⌄</span>
        </button>{showProfileMenu && <div className="domain-list-profile-menu"><button onClick={onSettings}>Settings</button><button onClick={onLogout}>Log out</button></div>}</div>
      </div>
    </header>
    <main className="domain-list-main account-main">
      <nav className="domain-list-tabs" aria-label="Settings navigation"><button onClick={onSettings}>Settings</button><button className="is-active" aria-current="page">Account</button>
        <button disabled={!activeKey} onClick={() => onConfiguration(activeKey, domain?.domain_name || '')}>Configuration</button><button disabled title="Billing is not available yet">Plan &amp; Billing</button>
        <button onClick={onDomains}>Domain</button><button disabled title="PWA settings are not available yet">PWA Setting</button><button disabled title="User management is not available yet">User</button>
      </nav>
      <div className="account-grid">
        <section className="account-panel" aria-label="Account profile">
          {loading && <p className="account-note" role="status">Loading account…</p>}
          {error && <p className="account-error" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
          {profile && !loading && !error && <div className="account-profile-box">
            <div className="account-avatar" aria-hidden="true"><svg viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="47" fill="#dceef0" /><path d="M20 87c0-34 60-34 60 0" fill="#1e8398" /><circle cx="50" cy="37" r="20" fill="#388aa2" /></svg></div>
            <dl className="account-details">
              <div><dt>{profile.email ? 'Email' : 'Username'}</dt><dd>{profile.email || profile.username}</dd></div>
              <div><dt>Password</dt><dd aria-label="Password hidden">••••••••</dd></div>
              <div><dt>Last Login</dt><dd>{lastLogin}</dd></div>
              <div><dt>Connection IP</dt><dd>{profile.last_login_ip || 'Not recorded yet'}</dd></div>
              <div><dt>Status</dt><dd>{profile.status}</dd></div>
            </dl>
            <button type="button" className="account-delete" disabled title="Deletion of the administrator account is not available">Delete Account</button>
          </div>}
        </section>
        <section className="account-panel account-password-panel" aria-labelledby="change-password-heading">
          <h1 id="change-password-heading">Change Password</h1>
          <form onSubmit={changePassword}>
            <label htmlFor="account-current-password" className="account-sr-only">Current Password</label><input id="account-current-password" className="account-input" type="password" placeholder="Current Password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={!profile || loading || saving || Boolean(error)} />
            <label htmlFor="account-new-password" className="account-sr-only">New Password</label><div className="account-new-password"><input id="account-new-password" type={showPassword ? 'text' : 'password'} placeholder="New Password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={!profile || loading || saving || Boolean(error)} />
              <button type="button" aria-label={showPassword ? 'Hide new password' : 'Show new password'} aria-pressed={showPassword} disabled={saving} onClick={() => setShowPassword(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg></button>
            </div>
            <p className="account-note">Use 12–128 characters. Other dashboard sessions will be signed out.</p>
            {saveError && <p className="account-error" role="alert">{saveError}</p>}{message && <p className="account-success" role="status">{message}</p>}
            <button type="submit" className="account-save" disabled={!profile || loading || saving || Boolean(error)}>{saving ? 'Saving…' : 'Save'}</button>
          </form>
        </section>
      </div>
    </main>
  </div>;
}
