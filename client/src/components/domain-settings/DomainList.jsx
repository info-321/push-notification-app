import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './domain-list.css';

const labelFor = domain => domain.display_name || domain.domain_name;

export default function DomainList({ selectedDomainKey, onNew, onConfiguration, onDashboard, onSettings, onAccount, onLogout, onDeleted }) {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const selectAll = useRef(null);
  const nameInput = useRef(null);
  const editTrigger = useRef(null);
  const activeDomain = domains.find(domain => domain.domain_key === selectedDomainKey) || domains[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    async function load() {
      try {
        const response = await apiFetch(`${API_BASE}/api/domains`);
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not load domains.');
        if (!cancelled) {
          setDomains(result.data);
          setSelected(new Set());
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load domains.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.size > 0 && selected.size < domains.length;
  }, [selected, domains]);

  useEffect(() => {
    if (!editing) return;
    const trigger = editTrigger.current;
    nameInput.current?.focus();
    return () => trigger?.focus();
  }, [editing]);

  const configure = () => {
    if (activeDomain) onConfiguration(activeDomain.domain_key, activeDomain.domain_name);
  };

  const removeSelected = async () => {
    const targets = domains.filter(domain => selected.has(domain.id));
    if (!targets.length || !window.confirm(`Delete ${targets.length === 1 ? labelFor(targets[0]) : `${targets.length} selected domains`} and their saved subscriptions? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    setNotice('');
    const removed = [], failures = [];
    for (const domain of targets) {
      try {
        const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domain.id)}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.message || 'Could not delete domain.');
        removed.push(domain);
      } catch (err) { failures.push(`${labelFor(domain)}: ${err.message}`); }
    }
    const removedIds = new Set(removed.map(domain => domain.id));
    setDomains(current => current.filter(domain => !removedIds.has(domain.id)));
    setSelected(current => new Set([...current].filter(id => !removedIds.has(id))));
    if (removed.length) {
      setNotice(`${removed.length} ${removed.length === 1 ? 'domain deleted' : 'domains deleted'}.`);
      onDeleted?.(removed.map(domain => domain.domain_key));
    }
    if (failures.length) setError(failures.join(' '));
    setDeleting(false);
  };

  const saveName = async event => {
    event.preventDefault();
    if (!name.trim()) { setEditError('Name is required.'); return; }
    setSaving(true);
    setEditError('');
    try {
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(editing.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save domain.');
      setDomains(current => current.map(domain => domain.id === editing.id ? result.data : domain));
      setNotice('Domain name updated.');
      setEditing(null);
    } catch (err) { setEditError(err.message || 'Could not save domain.'); }
    finally { setSaving(false); }
  };

  return <div className="domain-list-page">
    <header className="domain-list-header">
      <div className="domain-list-brand">
        <button type="button" className="domain-list-logo" onClick={() => onDashboard()} aria-label="All websites"><img src="/images/TTWLogo.jpg" alt="TTW" /></button>
        <select aria-label="Select website" value={activeDomain?.domain_key || ''} disabled={!domains.length || deleting} onChange={event => {
          const domain = domains.find(item => item.domain_key === event.target.value);
          if (domain) onDashboard(domain.domain_key, domain.domain_name);
        }}>
          {!domains.length && <option value="">Select a website</option>}
          {domains.map(domain => <option key={domain.domain_key} value={domain.domain_key}>{domain.domain_name}</option>)}
        </select>
      </div>
      <div className="domain-list-account">
        <button className="domain-list-dashboard-link" onClick={() => onDashboard(activeDomain?.domain_key, activeDomain?.domain_name)}>Dashboard</button>
        <div className="domain-list-profile">
          <button type="button" className="domain-list-profile-trigger" aria-label="Account menu" aria-expanded={showProfile} onClick={() => setShowProfile(value => !value)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M5 19c1-6 13-6 14 0" /></svg><span aria-hidden="true">⌄</span>
          </button>
          {showProfile && <div className="domain-list-profile-menu"><button onClick={onSettings}>Settings</button><button onClick={onLogout}>Log out</button></div>}
        </div>
      </div>
    </header>

    <main className="domain-list-main">
      <nav className="domain-list-tabs" aria-label="Settings navigation">
        <button onClick={onSettings}>Settings</button>
        <button onClick={onAccount}>Account</button>
        <button onClick={configure} disabled={!activeDomain}>Configuration</button>
        <button className="is-active" aria-current="page">Domain</button>
        <button disabled title="PWA settings are not available yet">PWA Setting</button>
        <button disabled title="User management is not available yet">User</button>
      </nav>

      <section className="domain-list-panel" aria-label="Domains">
        <div className="domain-list-toolbar">
          <span role="status">{selected.size > 0 ? `${selected.size} selected` : ''}</span>
          <div><button type="button" className="domain-list-new" onClick={onNew} disabled={deleting}>New</button><button type="button" className="domain-list-delete" onClick={removeSelected} disabled={!selected.size || deleting}>{deleting ? 'Deleting…' : 'Delete'}</button></div>
        </div>
        {notice && <p className="domain-list-notice" role="status">{notice}</p>}
        {error && <div className="domain-list-error" role="alert">{error}{!domains.length && <button onClick={() => setReload(value => value + 1)}>Try again</button>}</div>}
        {loading ? <p className="domain-list-loading" role="status">Loading domains…</p> : <div className="domain-list-table-scroll">
          <table className="domain-list-table">
            <thead><tr><th className="domain-list-checkbox"><input type="checkbox" aria-label="Select all domains" ref={selectAll} checked={domains.length > 0 && selected.size === domains.length} disabled={!domains.length || deleting} onChange={event => setSelected(new Set(event.target.checked ? domains.map(domain => domain.id) : []))} /></th><th scope="col">Name</th><th scope="col">Domain</th><th scope="col">Action</th></tr></thead>
            <tbody>{domains.map(domain => <tr key={domain.id} className={selected.has(domain.id) ? 'is-selected' : ''}>
              <td className="domain-list-checkbox"><input type="checkbox" aria-label={`Select ${domain.domain_name}`} checked={selected.has(domain.id)} disabled={deleting} onChange={event => setSelected(current => {
                const next = new Set(current); if (event.target.checked) next.add(domain.id); else next.delete(domain.id); return next;
              })} /></td>
              <td>{labelFor(domain)}</td><td>{domain.domain_name}</td>
              <td><button type="button" className="domain-list-edit" disabled={deleting} aria-label={`Edit ${labelFor(domain)}`} onClick={event => {
                editTrigger.current = event.currentTarget; setEditing(domain); setName(labelFor(domain)); setEditError('');
              }}>Edit</button></td>
            </tr>)}
              {!domains.length && <tr><td colSpan="4" className="domain-list-empty">{error ? 'Domains could not be loaded.' : 'No domains yet. Click New to add your first website.'}</td></tr>}
            </tbody>
          </table>
        </div>}
      </section>
    </main>

    {editing && <div className="domain-list-modal-backdrop"><section className="domain-list-modal" role="dialog" aria-modal="true" aria-labelledby="domain-list-edit-title" onKeyDown={event => {
      if (event.key === 'Escape' && !saving) setEditing(null);
      if (event.key === 'Tab') {
        const focusable = [...event.currentTarget.querySelectorAll('input, button')].filter(element => !element.disabled);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <h1 id="domain-list-edit-title">Edit domain</h1>
      <form onSubmit={saveName}>
        <label htmlFor="domain-display-name">Name <span>*</span></label><input id="domain-display-name" ref={nameInput} value={name} maxLength={255} required disabled={saving} onChange={event => setName(event.target.value)} />
        <label htmlFor="domain-registered-address">Domain</label><input id="domain-registered-address" value={editing.domain_name} readOnly />
        <p>Add a new domain to use a different website address.</p>
        {editError && <p className="domain-list-error" role="alert">{editError}</p>}
        <div className="domain-list-modal-actions"><button type="button" className="domain-list-cancel" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="domain-list-new" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
      </form>
    </section></div>}
  </div>;
}
