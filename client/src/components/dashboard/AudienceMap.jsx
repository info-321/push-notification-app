import React, { useEffect, useId, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import world from './world-map.json';
import './audience-map.css';

const number = value => new Intl.NumberFormat().format(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const initialView = { x: 0, y: 0, zoom: 1 };

export default function AudienceMap({ domainKey, refresh = 0 }) {
  const [audience, setAudience] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState(initialView);
  const drag = useRef(null);
  const detailsId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setAudience(null);
    apiFetch(`${API_BASE}/api/domains/${encodeURIComponent(domainKey)}/audience`).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok || !Array.isArray(result.data?.countries)) throw new Error(result.message || 'Could not load audience locations.');
      if (!cancelled) setAudience(result.data);
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domainKey, refresh, retry]);

  useEffect(() => { setExpanded(false); setView(initialView); drag.current = null; }, [domainKey]);

  const located = audience?.located || 0;
  const countries = new Map((audience?.countries || []).map(country => [country.code, country]));
  const max = Math.max(1, ...(audience?.countries || []).map(country => country.subscribers));
  const fill = code => {
    const count = countries.get(code)?.subscribers || 0;
    return count ? count / max > .66 ? '#168b8e' : count / max > .33 ? '#63adb0' : '#a6d6d7' : '#d8dcdf';
  };
  const setZoom = amount => setView(current => {
    const zoom = clamp(current.zoom + amount, 1, 4);
    const width = world.width / zoom, height = world.height / zoom;
    return { zoom, x: clamp(current.x + world.width / current.zoom / 2 - width / 2, 0, world.width - width), y: clamp(current.y + world.height / current.zoom / 2 - height / 2, 0, world.height - height) };
  });
  const move = (dx, dy) => setView(current => ({ ...current, x: clamp(current.x + dx, 0, world.width - world.width / current.zoom), y: clamp(current.y + dy, 0, world.height - world.height / current.zoom) }));

  return <section className="audience-section" aria-labelledby="overview-audience">
    <div className="audience-heading"><h2 className="overview-section-title" id="overview-audience">Audience</h2><button type="button" disabled={!audience} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide details' : 'View All'}</button></div>
    <div className="overview-panel audience-panel">
      <div className="audience-map-frame">
        <svg className={`audience-world-map ${view.zoom > 1 ? 'is-zoomed' : ''}`} viewBox={`${view.x} ${view.y} ${world.width / view.zoom} ${world.height / view.zoom}`} role="group" aria-label="World map of audience countries" tabIndex={0}
          onKeyDown={event => {
            const directions = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -25], ArrowDown: [0, 25] };
            if (directions[event.key] && view.zoom > 1) { event.preventDefault(); move(...directions[event.key]); }
          }}
          onPointerDown={event => {
            if (view.zoom === 1 || event.button !== 0) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={event => {
            if (drag.current?.id !== event.pointerId) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const dx = (drag.current.x - event.clientX) * (world.width / view.zoom) / bounds.width;
            const dy = (drag.current.y - event.clientY) * (world.height / view.zoom) / bounds.height;
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; move(dx, dy);
          }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <title>Audience locations by country</title>
          {world.countries.map(country => {
            const count = countries.get(country.code)?.subscribers || 0;
            const label = `${countries.get(country.code)?.name || country.name}: ${number(count)} located ${count === 1 ? 'subscription' : 'subscriptions'}`;
            return <path key={country.code} d={country.path} data-country={country.code} fill={fill(country.code)} stroke="#ffffff" strokeWidth=".65" vectorEffect="non-scaling-stroke" role="img" aria-label={label} tabIndex={count ? 0 : undefined}><title>{label}</title></path>;
          })}
        </svg>
        <div className="audience-map-controls" role="group" aria-label="Map controls"><button type="button" aria-label="Zoom in" disabled={view.zoom >= 4} onClick={() => setZoom(1)}>+</button><button type="button" aria-label="Zoom out" disabled={view.zoom === 1} onClick={() => setZoom(-1)}>&#8722;</button><button type="button" className="audience-map-reset" disabled={view.zoom === 1} onClick={() => setView(initialView)}>Reset</button></div>
        <a className="audience-map-attribution" href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">Natural Earth</a>
      </div>
      {loading && <p className="audience-map-note" role="status">Loading audience locations...</p>}
      {error && <p className="audience-map-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
      {audience && <>
        <div className="audience-map-legend"><span><i style={{ background: '#d8dcdf' }} />No located subscriptions</span><span><i style={{ background: '#a6d6d7' }} /><i style={{ background: '#63adb0' }} /><i style={{ background: '#168b8e' }} />Fewer to more</span></div>
        <p className="audience-map-note">{audience.total === 0 ? 'No subscriptions yet. Countries appear as browsers subscribe.' : located === 0 ? 'Country locations will appear as subscribed browsers revisit your website.' : 'Approximate countries from browser connections.'}{audience.unknown > 0 ? ` Location unknown for ${number(audience.unknown)} ${audience.unknown === 1 ? 'subscription' : 'subscriptions'}.` : ''}</p>
      </>}
      {expanded && audience && <div className="audience-country-details" id={detailsId}>
        <h3>Audience by country</h3><p>Counts are saved browser subscriptions. IP country estimates can reflect VPNs or proxies.</p>
        <table><thead><tr><th scope="col">Country</th><th scope="col">Subscriptions</th></tr></thead><tbody>
          {audience.countries.map(country => <tr key={country.code}><td>{country.name}</td><td>{number(country.subscribers)}</td></tr>)}
          {audience.unknown > 0 && <tr><td>Location unknown</td><td>{number(audience.unknown)}</td></tr>}
          {audience.total === 0 && <tr><td colSpan="2">No audience data yet.</td></tr>}
        </tbody></table>
      </div>}
    </div>
  </section>;
}
