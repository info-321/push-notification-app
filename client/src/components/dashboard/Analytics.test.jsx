import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Analytics, { presetRange } from './Analytics';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
const domain = { domain_key: 'mice', domain_name: 'micetraveladvisor.com', display_name: 'MICE Travel Advisor' };
const audience = { countries: [{ code: 'IN', name: 'India', subscribers: 5 }], located: 5, unknown: 2, total: 7 };
const response = (data, ok = true, message) => ({ ok, json: async () => ({ ok, data, message }) });
beforeEach(() => {
  jest.resetAllMocks();
  apiFetch.mockImplementation(async url => {
    if (url.endsWith('/api/domains')) return response([domain, { domain_key: 'second', domain_name: 'second.test' }]);
    if (url.endsWith('/overview')) return response({ domain, subscribers: { total: 7, web: 7, mobile: null, app: null } });
    if (url.endsWith('/audience')) return response(audience);
    const query = new URL(url).searchParams;
    const start = query.get('start'), end = query.get('end');
    return response({ range: { start, end, time_zone: 'UTC' }, daily: [{ date: start, added: 2 }], added: 2, mobile: null, desktop: null, app: null, unsubscribed: null, net: null, browser: { available: false, rows: [] }, basis: 'Currently saved subscription records. Removal history was not recorded.' });
  });
});

test('Analytics shows real totals, countries and map while unavailable metadata stays unavailable', async () => {
  render(<Analytics domainKey="mice" />);
  expect(await screen.findByRole('heading', { name: 'MICE Travel Advisor Analytics' })).toBeInTheDocument();
  expect(screen.getByLabelText('Total Subscribers: 7')).toBeInTheDocument();
  expect(screen.getByLabelText('Mobile Subscribers: Not available')).toBeInTheDocument();
  const countryTable = screen.getByRole('table', { name: 'Audience by country' });
  expect(within(countryTable).getByText('India')).toBeInTheDocument();
  expect(within(countryTable).getByText('Location unknown')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'India: 5 located subscriptions' })).toHaveAttribute('fill', '#168b8e');
  expect(screen.getByRole('tab', { name: 'State', exact: true })).toBeEnabled();
  expect(screen.getByRole('tab', { name: 'City', exact: true })).toBeEnabled();
  expect(await screen.findByRole('img', { name: 'Subscriber browser distribution' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /View All/ })).not.toBeInTheDocument();
  // The large map reuses the country result, rather than loading it twice.
  expect(apiFetch.mock.calls.filter(([url]) => url.endsWith('/audience'))).toHaveLength(1);
});

test('date presets and custom ranges request the selected domain and keep unknown history distinct from zero', async () => {
  render(<Analytics domainKey="mice" />);
  const subscribers = screen.getByRole('region', { name: 'Subscribers', exact: true });
  await within(subscribers).findByRole('img', { name: 'Saved subscriptions added per day' });
  const summary = within(subscribers).getByRole('table', { name: 'Subscriber period summary' });
  expect(within(summary).getAllByLabelText('Not recorded')).toHaveLength(5);
  fireEvent.click(within(subscribers).getByRole('button', { name: 'Today', exact: true }));
  const today = new Date().toISOString().slice(0, 10);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`https://api.example.test/api/domains/mice/analytics?start=${today}&end=${today}`));
  fireEvent.click(within(subscribers).getByRole('button', { name: 'Custom Dates' }));
  fireEvent.change(within(subscribers).getByLabelText('From'), { target: { value: '2024-01-01' } });
  fireEvent.change(within(subscribers).getByLabelText('To'), { target: { value: '2024-01-03' } });
  fireEvent.click(within(subscribers).getByRole('button', { name: 'Apply dates' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('https://api.example.test/api/domains/mice/analytics?start=2024-01-01&end=2024-01-03'));
  await within(subscribers).findByRole('img', { name: 'Saved subscriptions added per day' });
  const updatedSummary = within(subscribers).getByRole('table', { name: 'Subscriber period summary' });
  const additions = within(updatedSummary).getByRole('row', { name: 'Subscribers Added 2' });
  expect(additions).toBeInTheDocument();
  expect(apiFetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

test('date presets use UTC and Monday week starts across month and year boundaries', () => {
  expect(presetRange('week', '2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  expect(presetRange('month', '2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-01-01' });
  expect(presetRange('today', '2024-02-29')).toEqual({ start: '2024-02-29', end: '2024-02-29' });
});

test('recorded desktop counts replace null and remaining unknown subscriptions are explained', async () => {
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation(async url => {
    const result = await original(url);
    if (!url.includes('/analytics?')) return result;
    const body = await result.json();
    return response({ ...body.data, desktop: 1, mobile: 0, device_unknown: 1, device_recorded: 1, device_available: true,
      daily: body.data.daily.map(day => ({ ...day, desktop: 1, mobile: 0, device_unknown: 1 })) });
  });
  render(<Analytics domainKey="mice" />);
  const subscribers = screen.getByRole('region', { name: 'Subscribers', exact: true });
  const summary = await within(subscribers).findByRole('table', { name: 'Subscriber period summary' });
  expect(within(summary).getByRole('row', { name: 'Desktop 1', exact: true })).toBeInTheDocument();
  expect(within(summary).getByRole('row', { name: 'Mobile 0', exact: true })).toBeInTheDocument();
  expect(within(subscribers).getByRole('note')).toHaveTextContent('Device type is unknown for 1 subscription');
  expect(within(subscribers).getByRole('button', { name: 'Desktop Subs', exact: true })).toBeEnabled();
});

test('browser chart uses saved counts and its own date filters without changing the Subscribers period', async () => {
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation(async url => {
    const result = await original(url);
    if (!url.includes('/analytics?')) return result;
    const body = await result.json();
    return response({ ...body.data, browser: { available: true, rows: [{ name: 'Edge', subscribers: 1 }], total: 2, unknown: 1, recorded: 1 } });
  });
  render(<Analytics domainKey="mice" />);
  const browser = screen.getByRole('region', { name: 'Audience Browser Analytic', exact: true });
  expect(await within(browser).findByRole('row', { name: 'Edge 1 50.0%' })).toBeInTheDocument();
  expect(within(browser).getByRole('row', { name: 'Unknown 1 50.0%' })).toBeInTheDocument();
  fireEvent.click(within(browser).getByRole('button', { name: 'Today', exact: true }));
  const today = new Date().toISOString().slice(0, 10);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`https://api.example.test/api/domains/mice/analytics?start=${today}&end=${today}`));
  const subscribers = screen.getByRole('region', { name: 'Subscribers', exact: true });
  expect(within(subscribers).getByRole('button', { name: 'This Month', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(apiFetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

test('country errors can retry without displaying invented zero totals and navigation keeps the website', async () => {
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation(async url => url.endsWith('/audience') ? response(null, false, 'Locations unavailable') : original(url));
  const dashboard = jest.fn(), select = jest.fn(), send = jest.fn();
  render(<Analytics domainKey="mice" onDashboard={dashboard} onSelectDomain={select} onSendPush={send} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Locations unavailable');
  expect(screen.getByLabelText('Total Subscribers: 7')).toBeInTheDocument();
  apiFetch.mockImplementation(original);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('img', { name: 'India: 5 located subscriptions' });
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard', exact: true }));
  expect(dashboard).toHaveBeenCalledWith('mice', 'micetraveladvisor.com');
  fireEvent.change(screen.getByRole('combobox', { name: 'Website', exact: true }), { target: { value: 'second' } });
  expect(select).toHaveBeenCalledWith('second', 'second.test');
  fireEvent.click(screen.getByRole('button', { name: 'Send Push', exact: true }));
  expect(send).toHaveBeenCalledWith('mice', 'micetraveladvisor.com');
});
