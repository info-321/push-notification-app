import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dashboard from './Dashboard';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));

const domain = { domain_key: 'mice', domain_name: 'micetraveladvisor.com', is_configured: true };
const overview = total => ({ domain, subscribers: { total, web: total, mobile: null, app: null }, updated_at: '2026-10-28T08:00:00Z' });

beforeEach(() => jest.resetAllMocks());
function respond(total = 7) {
  apiFetch.mockImplementation(async url => ({ ok: true, json: async () => ({ ok: true, data: url.endsWith('/overview') ? overview(total) : url.endsWith('/audience') ? { countries: [], located: 0, unknown: total, total, capture_available: false } : [domain] }) }));
}

test('uses the selected domain counts, marks unknown breakdowns, and routes quick links', async () => {
  respond();
  const config = jest.fn(), send = jest.fn();
  render(<Dashboard domainKey="mice" onConfiguration={config} onSendPush={send} />);
  expect(await screen.findByLabelText('Total Subscribers: 7')).toBeTruthy();
  expect(screen.getByLabelText('Web Subscribers: 7')).toBeTruthy();
  expect(screen.getByLabelText('Mobile Subscribers: Not available')).toBeTruthy();
  expect(screen.getByText('Campaign reporting is not enabled yet')).toBeTruthy();
  expect(apiFetch).toHaveBeenCalledWith('https://api.example.test/api/domains/mice/overview');
  fireEvent.click(screen.getByRole('button', { name: /Send Push/ }));
  fireEvent.click(screen.getByRole('button', { name: /Manage WordPress setup/ }));
  expect(send).toHaveBeenCalledWith('mice', 'micetraveladvisor.com');
  expect(config).toHaveBeenCalledWith('mice', 'micetraveladvisor.com');
  expect(apiFetch.mock.calls.some(([url]) => url.endsWith('/api/notifications'))).toBe(false);
});

test('refresh retrieves new totals and an empty audience shows zero rather than example data', async () => {
  respond(0);
  render(<Dashboard domainKey="mice" />);
  expect(await screen.findByLabelText('Total Subscribers: 0')).toBeTruthy();
  respond(8);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(await screen.findByLabelText('Total Subscribers: 8')).toBeTruthy();
});

test('request failure shows a retry state without misleading zero counts', async () => {
  apiFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Domain not found' }) });
  render(<Dashboard domainKey="missing" />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Domain not found'));
  expect(screen.queryByLabelText('Total Subscribers: 0')).toBeNull();
  respond(2);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByLabelText('Total Subscribers: 2')).toBeTruthy());
});
