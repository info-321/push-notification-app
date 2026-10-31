import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleList from './ScheduleList';
import { apiFetch } from '../../api';
jest.mock('../../api', () => ({ API_BASE: 'https://api.test', apiFetch: jest.fn() }));
const response = data => ({ ok: true, json: async () => ({ ok: true, data, message: 'Schedule updated.' }) });
beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'PATCH') return response(null);
    if (url.endsWith('/api/domains')) return response([{ domain_key: 'site', domain_name: 'example.test' }]);
    if (url.endsWith('/status')) return response({ running: true });
    if (url.endsWith('/runs')) return response([{ due_at: '2027-01-01T12:00:00Z', status: 'completed', message: 'Accepted by push services: 2.', result: { sent: 2, failed: 0, removed: 0 } }]);
    return response({ rows: [{ id: 'job', content: { title: 'Travel news', audience: { platform: 'desktop', subscribed: 'all' } }, schedule: { kind: 'recurring', frequency: 'daily', interval: 1, time_zone: 'UTC' }, status: 'active', next_run_at: '2027-01-02T12:00:00Z' }], page: 1, pages: 1, total: 1 });
  });
});
test('the domain-scoped list shows schedule status, history and working pause/cancel controls', async () => {
  render(<ScheduleList domainKey="site" />);
  await screen.findByText('Travel news');
  expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/domains/site/schedules?page=1');
  expect(screen.getByText(/Backend scheduler is running/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'History', exact: true }));
  expect(await screen.findByRole('region', { name: 'Schedule history' })).toHaveTextContent('Accepted: 2. Failed: 0.');
  fireEvent.click(screen.getByRole('button', { name: 'Pause', exact: true }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/schedules/job', expect.objectContaining({ method: 'PATCH', body: '{"action":"pause"}' })));
  await screen.findByText('Travel news');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/schedules/job', expect.objectContaining({ body: '{"action":"cancel"}' })));
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
test('a missing heartbeat warns the operator and uncertain one-time sends cannot be resumed', async () => {
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((url, options) => {
    if (url.endsWith('/status')) return Promise.resolve(response({ running: false }));
    if (url.includes('/schedules?page=')) return Promise.resolve(response({ rows: [{ id: 'held', content: { title: 'Review this', audience: { platform: 'all', subscribed: 'all' } }, schedule: { kind: 'once', time_zone: 'UTC' }, status: 'needs_review' }], page: 1, pages: 1, total: 1 }));
    return original(url, options);
  });
  render(<ScheduleList domainKey="site" />); await screen.findByText('Review this');
  expect(screen.getByText(/Scheduler heartbeat is unavailable/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume future sends' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel schedule' })).toBeEnabled();
});
