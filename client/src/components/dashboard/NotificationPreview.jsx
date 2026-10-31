import React, { useId, useState } from 'react';
import Icon from './DashboardIcon';

export default function NotificationPreview({ draft, domainName }) {
  const [platform, setPlatform] = useState('Windows');
  const id = useId(), platforms = ['Windows', 'MacOS', 'Mobile'];
  return <section className="push-preview" aria-label="Notification preview">
    <div className="push-preview-tabs" role="tablist" aria-label="Preview platform" onKeyDown={event => {
      const index = platforms.indexOf(platform);
      const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
      if (next === null) return;
      event.preventDefault(); setPlatform(platforms[next]); event.currentTarget.querySelectorAll('button')[next].focus();
    }}>{platforms.map(name => <button type="button" role="tab" key={name} id={`${id}-${name}`} aria-controls={`${id}-panel`} aria-selected={platform === name} tabIndex={platform === name ? 0 : -1} onClick={() => setPlatform(name)}>{name}</button>)}</div>
    <div className={`push-device push-device-${platform.toLowerCase()}`} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${platform}`}>
      <div className="push-device-screen"><div className="push-notification-sample">
        <span className="push-preview-icon"><Icon name="bell" />{draft.icon && <img key={draft.icon} src={draft.icon} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} />}</span>
        <div className="push-preview-copy"><strong>{draft.title || 'Push Title'}</strong><p>{draft.body || 'Push Body'}</p><small>{domainName}</small></div>
        {draft.banner?.enabled && draft.banner.image && <img className="push-preview-banner" key={draft.banner.image} src={draft.banner.image} alt="Banner preview" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} />}
        {draft.banner?.enabled ? draft.banner.actions.map((item, index) => <span key={index} className="push-preview-action">{item.title || `Button ${index + 1}`}</span>) : <span className="push-preview-action">Read More</span>}
      </div></div>
    </div>
    <p className="push-help">Preview only. Notification appearance and available controls vary by browser and device. Clicking a notification opens its URL.</p>
  </section>;
}
