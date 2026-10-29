import React, { useState } from 'react';

const palette = { Chrome: '#61b38e', Firefox: '#6799dd', Edge: '#6c70e9', Safari: '#8569de', Opera: '#d96980', 'Samsung Internet': '#3e91bc', Brave: '#f19245', Other: '#8a9ca7', Unknown: '#c7cdd2' };
const number = value => new Intl.NumberFormat().format(value);
const percent = (count, total) => `${(total ? count / total * 100 : 0).toFixed(1)}%`;
const point = (angle, offset = 0) => [500 + Math.cos(angle) * 165, 190 + offset + Math.sin(angle) * 146];
const darken = color => `#${color.slice(1).match(/../g).map(part => Math.round(parseInt(part, 16) * .76).toString(16).padStart(2, '0')).join('')}`;

function slicePath(start, end, offset = 0) {
  if (end - start >= Math.PI * 2 - 1e-8) return `M500 ${44 + offset} A165 146 0 1 1 500 ${336 + offset} A165 146 0 1 1 500 ${44 + offset} Z`;
  const first = point(start, offset), last = point(end, offset);
  return `M500 ${190 + offset} L${first.join(' ')} A165 146 0 ${end - start > Math.PI ? 1 : 0} 1 ${last.join(' ')} Z`;
}

export default function BrowserChart({ browser, total = 0 }) {
  const [active, setActive] = useState(null);
  const counts = new Map((browser?.rows || []).map(row => [row.name, row.subscribers]));
  const known = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const unknown = browser?.unknown ?? Math.max(0, total - known);
  const names = [...Object.keys(palette).filter(name => name !== 'Unknown' && (['Chrome', 'Firefox', 'Edge', 'Safari'].includes(name) || counts.has(name))), ...(unknown > 0 ? ['Unknown'] : [])];
  const rows = names.map(name => ({ name, subscribers: name === 'Unknown' ? unknown : counts.get(name) || 0, color: palette[name] }));
  let angle = -Math.PI / 2;
  const slices = rows.filter(row => row.subscribers > 0).map(row => {
    const start = angle, end = angle + row.subscribers / total * Math.PI * 2;
    angle = end;
    return { ...row, start, end, mid: (start + end) / 2 };
  });
  const labels = slices.map(slice => {
    const side = Math.cos(slice.mid) >= 0 ? 1 : -1;
    return { ...slice, side, labelY: 190 + Math.sin(slice.mid) * 168 };
  });
  // Separate callouts for small adjacent slices, keeping labels in the canvas.
  for (const side of [-1, 1]) {
    const group = labels.filter(label => label.side === side).sort((a, b) => a.labelY - b.labelY);
    group.forEach((label, index) => { label.labelY = Math.max(26, label.labelY, index ? group[index - 1].labelY + 25 : 26); });
    const overflow = Math.max(0, (group[group.length - 1]?.labelY || 0) - 374);
    group.forEach(label => { label.labelY -= overflow; });
  }
  const selected = rows.find(row => row.name === active);

  return <div className="analytics-browser-chart" onPointerLeave={() => setActive(null)}>
    {total > 0 ? <div className="analytics-browser-canvas">
      <svg viewBox="0 0 1000 410" role="img" aria-label="Subscriber browser distribution">
        <title>{rows.filter(row => row.subscribers > 0).map(row => `${row.name}: ${number(row.subscribers)} (${percent(row.subscribers, total)})`).join(', ')}</title>
        <g aria-hidden="true">
          {slices.map(slice => <path key={slice.name} d={slicePath(slice.start, slice.end, 17)} fill={darken(slice.color)} />)}
          {slices.map(slice => <path key={slice.name} d={slicePath(slice.start, slice.end)} fill={slice.color}
            stroke={active === slice.name ? '#fff' : 'none'} strokeWidth="2" opacity={!active || active === slice.name ? 1 : .8}
            onPointerEnter={() => setActive(slice.name)}><title>{slice.name}: {number(slice.subscribers)} ({percent(slice.subscribers, total)})</title></path>)}
          {labels.map(label => {
            const [x, y] = point(label.mid), endX = 500 + label.side * 205;
            return <g key={label.name} className="analytics-browser-callout">
              <polyline points={`${x},${y} ${endX - label.side * 8},${label.labelY} ${endX},${label.labelY}`} />
              <text x={endX + label.side * 6} y={label.labelY + 5} textAnchor={label.side === 1 ? 'start' : 'end'}>{label.name}: {percent(label.subscribers, total)}</text>
            </g>;
          })}
        </g>
      </svg>
      {selected && <div className="analytics-browser-tooltip" role="status"><strong>{selected.name}</strong><span>{number(selected.subscribers)} subscriptions · {percent(selected.subscribers, total)}</span></div>}
    </div> : <div className="analytics-browser-no-data"><span aria-hidden="true" /><p>No subscribers in this date range.</p></div>}
    <div className="analytics-browser-legend" role="group" aria-label="Browser chart legend">
      {rows.map(row => <button type="button" key={row.name} aria-pressed={active === row.name} onFocus={() => setActive(row.name)} onBlur={() => setActive(null)} onClick={() => setActive(row.name)}>
        <span style={{ background: row.color }} /><span>{row.name}</span><span>{percent(row.subscribers, total)}</span>
      </button>)}
      <button type="button" disabled title="Native app subscriptions are not tracked"><span style={{ background: '#22bfbf' }} /><span>App</span><span>Not tracked</span></button>
    </div>
    <table className="overview-sr-only"><caption>Subscriber browser counts</caption><thead><tr><th scope="col">Browser</th><th scope="col">Subscriptions</th><th scope="col">Percentage</th></tr></thead><tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{number(row.subscribers)}</td><td>{percent(row.subscribers, total)}</td></tr>)}</tbody></table>
    {unknown > 0 && <p className="analytics-note analytics-browser-note">Browser is unknown for {number(unknown)} {unknown === 1 ? 'subscription' : 'subscriptions'}. Visit the website from those subscribed browsers, then refresh data. Percentages include unknown subscriptions.</p>}
    <p className="analytics-note analytics-browser-note">Browser families are approximate. This report covers currently saved subscriptions created in the selected date range.</p>
  </div>;
}
