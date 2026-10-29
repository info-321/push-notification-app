import React, { useId, useState } from 'react';

const series = [
  ['App Subs', '#ff2626', 'app'], ['Desktop Subs', '#008e16', 'desktop'], ['Mobile Subs', '#173bff', 'mobile'],
  ['Total Subs', '#ff9d00', 'added'], ['Unsubscribers', '#222222', 'unsubscribed'],
];
const number = value => new Intl.NumberFormat().format(value);
const dateLabel = date => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export default function SubscriberChart({ daily, devicesAvailable = false }) {
  const [hidden, setHidden] = useState({});
  const [selected, setSelected] = useState(null);
  const id = useId();
  if (!daily.length) return <p className="analytics-note">No saved subscription dates are available.</p>;
  const max = Math.max(1, ...daily.map(day => day.added));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, max / 8)));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= max / 8) * magnitude;
  const top = Math.max(4, Math.ceil(max / step)) * step;
  const x = index => daily.length === 1 ? 275 : 44 + index / (daily.length - 1) * 462;
  const y = count => 246 - count / top * 228;
  const available = series.filter(([, , key]) => key === 'added' || (devicesAvailable && ['desktop', 'mobile'].includes(key)));
  const shown = available.filter(([, , key]) => !hidden[key]);
  const interval = Math.max(1, Math.ceil((daily.length - 1) / 14));
  const labels = daily.map((_, index) => index).filter(index => index % interval === 0 || index === daily.length - 1);
  const active = shown.length ? daily.findIndex(day => day.date === selected) : -1;

  return <div className="analytics-subscriber-chart">
    <div className="analytics-chart" onPointerLeave={() => setSelected(null)}>
      <p id={`${id}-help`} className="overview-sr-only">Use the left and right arrow keys to inspect daily counts, or Home and End to jump to the first and last day.</p>
      <svg viewBox="0 0 520 338" role="img" aria-label="Saved subscriptions added per day" aria-describedby={`${id}-help`} tabIndex={0}
        onFocus={() => setSelected(daily[0].date)} onBlur={() => setSelected(null)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? Math.min(daily.length - 1, Math.max(0, active) + 1)
            : event.key === 'ArrowLeft' ? Math.max(0, active - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? daily.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setSelected(daily[next].date);
        }}
        onPointerMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = (event.clientX - bounds.left) / bounds.width * 520;
          setSelected(daily[Math.max(0, Math.min(daily.length - 1, Math.round((position - 44) / 462 * (daily.length - 1))))].date);
        }}>
        <title>Daily additions among currently saved subscriptions</title>
        {Array.from({ length: top / step + 1 }, (_, index) => <g key={index}>
          <line x1="44" x2="506" y1={y(index * step)} y2={y(index * step)} className="analytics-chart-grid" />
          <text x="34" y={y(index * step) + 4} textAnchor="end">{number(index * step)}</text>
        </g>)}
        {labels.map(index => <g key={daily[index].date}>
          <line x1={x(index)} x2={x(index)} y1="18" y2="246" className="analytics-chart-grid" />
          <text transform={`translate(${x(index) + 3},262) rotate(-50)`} textAnchor="end">{dateLabel(daily[index].date)}</text>
        </g>)}
        <path d="M44 18V246H506" className="analytics-chart-axis" />
        {shown.map(([label, color, key]) => <g key={key} aria-label={label}>
          <polyline points={daily.map((day, index) => `${x(index)},${y(day[key] || 0)}`).join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {daily.map((day, index) => <circle key={day.date} cx={x(index)} cy={y(day[key] || 0)} r={index === active ? 4.5 : 2.5} fill="#fff" stroke={color} strokeWidth={index === active ? 2.5 : 1.5} />)}
        </g>)}
        {active >= 0 && <line x1={x(active)} x2={x(active)} y1="18" y2="246" className="analytics-chart-guide" />}
      </svg>
      {active >= 0 && <div role="status" className="analytics-chart-tooltip" style={{ left: `${Math.max(18, Math.min(78, x(active) / 520 * 100))}%`, top: `${Math.max(9, Math.min(55, y(daily[active].added) / 338 * 100 + 5))}%` }}>
        <strong>{dateLabel(daily[active].date)}</strong>{shown.map(([label, color, key]) => <span key={key}><i style={{ background: color }} />{label}: {number(daily[active][key] || 0)}</span>)}
        {devicesAvailable && daily[active].device_unknown > 0 && <span>Device unknown: {number(daily[active].device_unknown)}</span>}
      </div>}
      {!shown.length && <p className="analytics-chart-hidden">All series hidden. Select a legend item to show the chart.</p>}
    </div>
    <div className="analytics-chart-legend" role="group" aria-label="Subscriber chart series">
      {series.map(([label, color, key]) => <button type="button" key={label} disabled={!available.some(item => item[2] === key)} aria-pressed={available.some(item => item[2] === key) ? !hidden[key] : undefined}
        title={available.some(item => item[2] === key) ? `Show or hide ${label}` : `${label}: not recorded`}
        onClick={() => { setHidden(current => ({ ...current, [key]: !current[key] })); setSelected(null); }}>
        <span className="analytics-legend-swatch" style={{ borderColor: color }} /><span>{label}</span>{!available.some(item => item[2] === key) && <span className="overview-sr-only"> (Not recorded)</span>}
      </button>)}
    </div>
  </div>;
}
