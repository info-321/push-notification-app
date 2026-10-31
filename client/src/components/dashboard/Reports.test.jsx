import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import Reports, { ReportsSummary, ReportTable } from './Reports';
import { apiFetch } from '../../api';
jest.mock('../../api', () => ({ API_BASE: 'https://api.test', apiFetch: jest.fn() }));
const campaign = { id: 'campaign-1', source: 'composer', is_test: false, content: { title: 'Travel news', body: 'The latest story.', icon: '', url: '/news', audience: { platform: 'desktop', subscribed: '7d' } }, status: 'completed', targeted: 10, accepted: 8, failed: 1, expired: 1, acknowledged: 5, clicks: 2, click_rate: 25, sent_at: '2026-10-31T10:00:00Z' };
const response = data => ({ ok: true, json: async () => ({ ok: true, data }) });
beforeEach(() => {
  apiFetch.mockReset(); apiFetch.mockImplementation(async url => url.endsWith('/api/domains') ? response([{ domain_key: 'site', domain_name: 'site.test', time_zone: 'Asia/Kolkata' }]) : response({ rows: [campaign], total: 21, page: url.includes('page=2') ? 2 : 1, pages: 2 }));
});
test('full reports show real metrics, website-local dates and a safe copy-to-draft link', async () => {
  render(<Reports domainKey="site" />); await screen.findByText('Travel news');
  expect(screen.getByText('31 Oct 2026, 15:30')).toBeInTheDocument(); expect(screen.getByText('25.00%')).toBeInTheDocument();
  const copy = screen.getByRole('link', { name: 'Copy to draft' }); expect(copy).toHaveAttribute('href', '/push?domain=site&copy=campaign-1'); expect(copy).toHaveAttribute('target', '_blank'); expect(copy).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Failed: 1')).toBeInTheDocument(); expect(screen.getByText('Expired: 1')).toBeInTheDocument();
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
test('title/date/status/test filters and pagination load the matching report API', async () => {
  render(<Reports domainKey="site" />); await screen.findByText('Travel news');
  fireEvent.change(screen.getByLabelText('Search title'), { target: { value: 'Travel' } });
  fireEvent.change(screen.getByLabelText('From date (UTC)'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Status', { exact: true }), { target: { value: 'partial' } });
  fireEvent.change(screen.getByLabelText('Tests', { exact: true }), { target: { value: 'include' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/domains/site/reports?q=Travel&from=2026-10-01&to=&status=partial&tests=include&page=1'));
  await screen.findByText('Travel news'); fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('Page 2 of 2 · 21 campaigns');
});
test('historical telemetry stays untracked and dashboard summary links to the full report page', async () => {
  const historical = { ...campaign, tracking: false, source: 'historical', clicks: null, acknowledged: null, click_rate: null };
  const view = render(<ReportTable rows={[historical]} domainKey="site" timeZone="UTC" />);
  expect(screen.getAllByText('Not tracked')).toHaveLength(2); expect(screen.getByText('Not available')).toBeInTheDocument(); view.unmount();
  render(<ReportsSummary domainKey="site" refresh={0} timeZone="UTC" />); await screen.findByText('Travel news');
  expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/domains/site/reports?limit=5&tests=hide');
  expect(screen.getByRole('link', { name: 'View All' })).toHaveAttribute('href', '/push/reports?domain=site');
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
});
test('CSV download uses the authenticated API and shows an error if export fails', async () => {
  const original = apiFetch.getMockImplementation(), clicked = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = jest.fn(() => 'blob:report'); URL.revokeObjectURL = jest.fn();
  apiFetch.mockImplementation((url, options) => url.includes('/export?') ? Promise.resolve({ ok: true, blob: async () => new Blob(['CSV']) }) : original(url, options));
  render(<Reports domainKey="site" />); await screen.findByText('Travel news'); fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled()); expect(clicked).toHaveBeenCalled();
  apiFetch.mockImplementation((url, options) => url.includes('/export?') ? Promise.resolve({ ok: false }) : original(url, options));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not download reports'); clicked.mockRestore();
});
