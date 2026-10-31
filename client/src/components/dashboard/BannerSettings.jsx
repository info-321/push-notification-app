import React, { useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';

export const newBanner = () => ({ enabled: false, image: '', actions: [{ title: 'Read More', url: '', type: 'link' }] });

// Decode locally and re-encode as PNG; the server never fetches uploaded URLs.
export async function bannerPng(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP image up to 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / bitmap.width, 800 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/png');
    if (data.length > 699074) throw new Error('This image is too detailed. Choose a smaller image (PNG output must be below 512 KB).');
    return data;
  } finally { bitmap.close(); }
}

export default function BannerSettings({ banner, onChange, domainKey, saveDefaults, onSaveDefaults, onBusy }) {
  const [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const uploadVersion = useRef(0);
  const update = (field, value) => onChange({ ...banner, [field]: value });
  const action = (index, field, value) => update('actions', banner.actions.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const upload = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const version = ++uploadVersion.current;
    setUploading(true); onBusy(true); setError('');
    try {
      const image = await bannerPng(file);
      const response = await apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/push-images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.data?.url) throw new Error(result.message || 'Could not upload the banner.');
      if (version === uploadVersion.current) update('image', result.data.url);
    } catch (err) { setError(err.message || 'Could not read this image.'); }
    finally { setUploading(false); onBusy(false); }
  };
  return <section className={`push-banner-settings ${banner.enabled ? 'is-enabled' : ''}`} aria-label="Banner Settings">
    <label className="push-audience-toggle">Banner Settings (Optional)<input type="checkbox" checked={banner.enabled} disabled={uploading} onChange={event => update('enabled', event.target.checked)} /></label>
    <p className="push-help">Images and buttons appear on supported browsers and operating systems.</p>
    {banner.enabled && <p className="push-help">WordPress requires the updated plugin (v1.2.0). <a href={`${API_BASE}/downloads/push-notifications-plugin.zip`}>Download plugin</a>, replace the installed copy, then revisit your website. Script installations must replace their push-sw.js.</p>}
    {banner.enabled && <fieldset disabled={uploading} className="push-banner-inner">
      <legend className="overview-sr-only">Banner content</legend>
      <label htmlFor="push-banner-image">Image</label>
      <div className="push-icon-input"><input id="push-banner-image" type="url" maxLength={2048} value={banner.image} onChange={event => update('image', event.target.value)} placeholder="https://your-website.com/image.png" /><label className="push-upload">Upload<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload banner image" onChange={upload} /></label></div>
      <p className="push-help">Optional HTTPS image URL, or upload PNG, JPEG, or WebP (up to 5 MB). Uploads are resized locally.</p>
      {banner.actions.map((item, index) => <div className="push-banner-button" key={index}>
        <div className="push-domain-label"><label htmlFor={`push-button-${index}`}>Button {index + 1}</label><button type="button" onClick={() => update('actions', banner.actions.filter((_, i) => i !== index))}>Remove button {index + 1}</button></div>
        <div className="push-button-fields"><input id={`push-button-${index}`} maxLength={40} value={item.title} onChange={event => action(index, 'title', event.target.value)} placeholder="Read More" /><input aria-label={`Button ${index + 1} URL`} maxLength={2048} value={item.url} onChange={event => action(index, 'url', event.target.value)} placeholder={item.type === 'call' ? 'tel:+911234567890' : 'URL (blank uses notification link)'} /></div>
        <label className="push-banner-check"><input type="checkbox" checked={item.type !== 'link'} onChange={event => update('actions', banner.actions.map((entry, i) => i === index ? { ...entry, type: event.target.checked ? 'facebook' : 'link', url: '' } : entry))} />Social media sharing / Click to call</label>
        {item.type !== 'link' && <select aria-label={`Button ${index + 1} action`} value={item.type} onChange={event => update('actions', banner.actions.map((entry, i) => i === index ? { ...entry, type: event.target.value, url: '' } : entry))}><option value="facebook">Share on Facebook</option><option value="x">Share on X</option><option value="whatsapp">Share on WhatsApp</option><option value="call">Click to call</option></select>}
      </div>)}
      {banner.actions.length < 2 && <button className="push-add-button" type="button" onClick={() => update('actions', [...banner.actions, { title: 'Read More', url: '', type: 'link' }])}>+ Add Button</button>}
    </fieldset>}
    <label className="push-banner-check"><input type="checkbox" checked={saveDefaults} onChange={event => onSaveDefaults(event.target.checked)} />Set above values as default</label>
    {saveDefaults && <p className="push-help">Saved for this website when you click Next. Other websites keep their own defaults.</p>}
    {uploading && <p role="status">Uploading banner image...</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
