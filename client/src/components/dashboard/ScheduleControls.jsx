import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE, apiFetch } from '../../api';
import './schedules.css';

export function newSchedule(zone = 'Asia/Kolkata') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + 5 * 60000)).map(item => [item.type, item.value]));
  return { kind: 'once', time_zone: zone, start: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`, frequency: 'daily', interval: 1, weekdays: [1, 2, 3, 4, 5], end_mode: 'count', count: 10, end_date: `${parts.year}-${parts.month}-${parts.day}` };
}
export const scheduleDate = (value, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ScheduleSummary({ value, upcoming = [] }) {
  return <div className="schedule-summary"><strong>{value.kind === 'once' ? 'One-time notification' : `Repeats every ${value.interval} ${value.frequency === 'daily' ? 'day(s)' : value.frequency === 'weekly' ? 'week(s)' : 'month(s)'}`}</strong><p>Time zone: {value.time_zone}</p>{upcoming.length > 0 && <ol>{upcoming.map(date => <li key={date}>{scheduleDate(date, value.time_zone)}</li>)}</ol>}{value.kind === 'recurring' && <p>{value.end_mode === 'count' ? `Ends after ${value.count} scheduled occurrences.` : value.end_mode === 'date' ? `Ends on ${value.end_date}.` : 'Repeats until you pause or cancel it.'}</p>}</div>;
}

export default function ScheduleControls({ value, onChange, onPreview }) {
  const [error, setError] = useState(''), [preview, setPreview] = useState(null);
  const zones = useMemo(() => [...new Set([value.time_zone, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || ['Asia/Kolkata', 'America/New_York', 'Europe/London'])])].sort(), [value.time_zone]);
  const update = (key, next) => onChange({ ...value, [key]: next });
  useEffect(() => {
    let cancelled = false; setPreview(null); setError(''); onPreview(null);
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/schedules/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: value }) });
        const result = await response.json(); if (!response.ok || !result.ok || !Array.isArray(result.data?.upcoming)) throw new Error(result.message || 'Could not check this schedule.');
        if (!cancelled) { setPreview(result.data); onPreview(result.data); }
      } catch (err) { if (!cancelled) setError(err.message); }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value, onPreview]);
  return <section className="schedule-controls" aria-label="Notification schedule"><h3>{value.kind === 'once' ? 'Schedule One Time' : 'Schedule Recurring'}</h3>
    <label>Time zone<select aria-label="Time zone" value={value.time_zone} onChange={event => update('time_zone', event.target.value)}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
    <label>{value.kind === 'once' ? 'Send date and time' : 'Start date and time'}<input type="datetime-local" required value={value.start} onChange={event => update('start', event.target.value)} /></label>
    {value.kind === 'recurring' && <><div className="schedule-two-fields"><label>Repeat<select aria-label="Repeat" value={value.frequency} onChange={event => onChange({ ...value, frequency: event.target.value, interval: 1 })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Every<input type="number" min={1} max={{ daily: 365, weekly: 52, monthly: 12 }[value.frequency]} required value={value.interval} onChange={event => update('interval', Number(event.target.value))} /></label></div>
      {value.frequency === 'weekly' && <fieldset className="schedule-weekdays"><legend>On these weekdays</legend>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => <label key={label}><input type="checkbox" checked={value.weekdays.includes(index + 1)} onChange={event => update('weekdays', event.target.checked ? [...value.weekdays, index + 1] : value.weekdays.filter(day => day !== index + 1))} />{label}</label>)}</fieldset>}
      {value.frequency === 'monthly' && <p className="push-help">Repeats on the start date's day. Shorter months use their last day.</p>}
      <label>Ends<select aria-label="Ends" value={value.end_mode} onChange={event => update('end_mode', event.target.value)}><option value="count">After a number of occurrences</option><option value="date">On a date</option><option value="never">When I pause or cancel it</option></select></label>
      {value.end_mode === 'count' && <label>Number of occurrences<input type="number" min={1} max={1000} required value={value.count} onChange={event => update('count', Number(event.target.value))} /></label>}
      {value.end_mode === 'date' && <label>End date<input type="date" required min={value.start.slice(0, 10)} value={value.end_date} onChange={event => update('end_date', event.target.value)} /></label>}
    </>}
    {error ? <p role="alert">{error}</p> : preview ? <ScheduleSummary value={value} upcoming={preview.upcoming} /> : <p role="status">Checking upcoming send times...</p>}
    <p className="push-help">The backend checks schedules about every 10 seconds. Occurrences over 15 minutes late are skipped. Recurrence follows local clock time; daylight-saving gaps shift forward and repeated times use the earlier occurrence.</p>
  </section>;
}
