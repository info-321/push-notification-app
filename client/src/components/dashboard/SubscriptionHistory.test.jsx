import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SubscriptionHistory from './SubscriptionHistory';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.test', apiFetch: jest.fn() }));
const event = type => ({ event_key: type, event_type: type, subscription_id: 1, occurred_ms: Date.parse('2026-11-20T08:00:00Z'), device_type: 'mobile', browser_family: 'Chrome' });
beforeEach(() => {
  jest.resetAllMocks();
  apiFetch.mockImplementation(async url => ({ ok: true, json: async () => ({ ok: true, data: { started_ms: Date.parse('2026-11-01T00:00:00Z'), rows: new URL(url).searchParams.get('event') === 'unsubscribed' ? [event('unsubscribed')] : [event('unsubscribed'), event('expired')] } }) }));
});

test('the Unsubscribed filter requests only voluntary opt-outs for the selected website and survives refresh', async () => {
  const { rerender } = render(<SubscriptionHistory domainKey="mice" refresh={0} />);
  expect(await screen.findByRole('table', { name: 'Subscription lifecycle events' })).toHaveTextContent('Expired');
  fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'unsubscribed' } });
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('https://api.test/api/domains/mice/subscription-history?offset=0&event=unsubscribed'));
  expect(await screen.findByRole('table', { name: 'Subscription lifecycle events' })).not.toHaveTextContent('Expired');
  expect(screen.getByRole('table')).toHaveTextContent('Unsubscribed');
  const count = apiFetch.mock.calls.length;
  rerender(<SubscriptionHistory domainKey="mice" refresh={1} />);
  await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(count));
  expect(apiFetch.mock.calls.at(-1)[0]).toContain('event=unsubscribed');
});

test('an empty unsubscribe history reports no events rather than inventing a subscriber', async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { started_ms: 1, rows: [] } }) });
  render(<SubscriptionHistory domainKey="mice" refresh={0} />);
  fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'unsubscribed' } });
  expect(await screen.findByText('No unsubscribed events in this history view.')).toBeInTheDocument();
});
