import React, { useId, useState } from 'react';

const tiers = [['country', 'Country'], ['state', 'State'], ['city', 'City']];
const number = value => new Intl.NumberFormat().format(value);

export default function AudienceGeography({ audience, loading = false }) {
  const [level, setLevel] = useState('country');
  const id = useId();
  const rows = level === 'country' ? audience?.countries || [] : level === 'state' ? audience?.states || [] : audience?.cities || [];
  const unknown = level === 'country' ? audience?.unknown || 0 : level === 'state' ? audience?.state_unknown ?? audience?.total ?? 0 : audience?.city_unknown ?? audience?.total ?? 0;
  const headers = ['S. No.', `${tiers.find(([value]) => value === level)[1]} Name`, ...(level === 'city' ? ['State Name'] : []), ...(level !== 'country' ? ['Country Name'] : []), 'Number Of Subscribers'];
  return <section className="analytics-geography" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Audience Geo Location</h2>
    <div className="overview-panel analytics-country-panel">
      <div className="analytics-geo-tabs" role="tablist" aria-label="Geography level" onKeyDown={event => {
        const current = tiers.findIndex(([value]) => value === level);
        const next = event.key === 'ArrowRight' ? (current + 1) % 3 : event.key === 'ArrowLeft' ? (current + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
        if (next === null) return;
        event.preventDefault(); setLevel(tiers[next][0]); event.currentTarget.querySelectorAll('[role="tab"]')[next].focus();
      }}>{tiers.map(([value, label]) => <button type="button" role="tab" key={value} id={`${id}-${value}`} aria-selected={value === level} aria-controls={`${id}-panel`} tabIndex={value === level ? 0 : -1} onClick={() => setLevel(value)}>{label}</button>)}</div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${level}`} tabIndex={0}>
        <div className="analytics-table-scroll"><table className={level === 'country' ? '' : 'analytics-detailed-geography'}>
          <caption className="overview-sr-only">Audience by {level}</caption>
          <thead><tr>{headers.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={JSON.stringify([row.country_code || row.code, row.code, row.region_code, row.region_name, row.name])}>
              <td>{index + 1}</td><td>{row.name}</td>{level === 'city' && <td>{row.region_name || 'Location unknown'}</td>}{level !== 'country' && <td>{row.country_name || row.country_code}</td>}<td>{number(row.subscribers)}</td>
            </tr>)}
            {audience && unknown > 0 && <tr><td>—</td><td>Location unknown</td>{headers.slice(2, -1).map(label => <td key={label}>—</td>)}<td>{number(unknown)}</td></tr>}
            {audience?.total === 0 && <tr><td colSpan={headers.length}>No subscribers yet.</td></tr>}
            {!audience && <tr><td colSpan={headers.length}>{loading ? 'Loading locations...' : 'Location data unavailable.'}</td></tr>}
          </tbody>
        </table></div>
        <p className="analytics-note">Locations are approximate and update when subscribed browsers revisit your website.</p>
        {audience && level !== 'country' && rows.length === 0 && audience.total > 0 && <p className="analytics-note analytics-location-setup">To collect state and city details, enable <strong>Add visitor location headers</strong> in Cloudflare, then revisit the website from subscribed browsers. <a href="https://developers.cloudflare.com/rules/transform/managed-transforms/configure/" target="_blank" rel="noopener noreferrer">Setup instructions</a></p>}
      </div>
    </div>
  </section>;
}
