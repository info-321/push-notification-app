import React, { useId, useState } from 'react';

const series = [
  ['App Subs', '#ff2626'], ['Desktop Subs', '#008e16'], ['Mobile Subs', '#173bff'],
  ['Total Subs', '#ff9d00'], ['Unsubscribers', '#222222'],
];
const number = value => new Intl.NumberFormat().format(value);
const dateLabel = date => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export default function SubscriberChart({ daily }) {
  const [visible, setVisible] = useState(true);
  const [selected, setSelected] = useState(null);
  const id = useId();
  if (!daily.length) return <p className="analytics-note">No saved subscription dates are available.</p>;
  const max = Math.max(1, ...daily.map(day => day.added));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, max / 8)));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= max / 8) * magnitude;
  const top = Math.max(4, Math.ceil(max / step)) * step;
  const x = index => daily.length === 1 ? 275 : 44 + index / (daily.length - 1) * 462;
  const y = count => 246 - count / top * 228;
  const points = daily.map((day, index) => `${x(index)},${y(day.added)}`).join(' ');
  const interval = Math.max(1, Math.ceil((daily.length - 1) / 14));
  const labels = daily.map((_, index) => index).filter(index => index % interval === 0 || index === daily.length - 1);
  const active = visible ? daily.findIndex(day => day.date === selected) : -1;

  return <div className="analytics-subscriber-chart">
    <div className="analytics-chart" onPointerLeave={() => setSelected(null)}>
      <p id={`${id}-help`} className="overview-sr-only">Use the left and right arrow keys to inspect daily totals, or Home and End to jump to the first and last day.</p>
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
        {visible && <g>
          <polyline points={points} fill="none" stroke="#ff9d00" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {daily.map((day, index) => <circle key={day.date} cx={x(index)} cy={y(day.added)} r={index === active ? 4.5 : 2.5} fill="#fff" stroke="#ff9d00" strokeWidth={index === active ? 2.5 : 1.5} />)}
        </g>}
        {active >= 0 && <line x1={x(active)} x2={x(active)} y1="18" y2="246" className="analytics-chart-guide" />}
      </svg>
      {active >= 0 && <div role="status" className="analytics-chart-tooltip" style={{ left: `${Math.max(18, Math.min(78, x(active) / 520 * 100))}%`, top: `${Math.max(7, Math.min(55, y(daily[active].added) / 338 * 100))}%` }}>
        <strong>{dateLabel(daily[active].date)}</strong><span><i />Total Subs: {number(daily[active].added)}</span>
      </div>}
      {!visible && <p className="analytics-chart-hidden">Total Subs hidden. Select it in the legend to show the chart.</p>}
    </div>
    <div className="analytics-chart-legend" role="group" aria-label="Subscriber chart series">
      {series.map(([label, color]) => <button type="button" key={label} disabled={label !== 'Total Subs'} aria-pressed={label === 'Total Subs' ? visible : undefined}
        title={label === 'Total Subs' ? 'Show or hide daily saved subscription additions' : `${label}: not recorded`}
        onClick={() => { setVisible(value => !value); setSelected(null); }}>
        <span className="analytics-legend-swatch" style={{ borderColor: color }} /><span>{label}</span>{label !== 'Total Subs' && <span className="overview-sr-only"> (Not recorded)</span>}
      </button>)}
    </div>
  </div>;
}
