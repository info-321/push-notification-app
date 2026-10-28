import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Settings from './Settings';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
const domains = [{ id: 1, domain_key: 'mice', domain_name: 'micetraveladvisor.com' }, { id: 2, domain_key: 'wood', domain_name: 'woodandpanel.com' }];
let zones;
const response = (data, ok = true, message) => ({ ok, json: async () => ({ ok, data, message }) });
beforeEach(() => {
  jest.resetAllMocks();
  zones = { mice: 'Asia/Kolkata', wood: 'Europe/London' };
  apiFetch.mockImplementation(async (url, options) => {
    if (url.endsWith('/api/domains')) return response(domains);
    const key = url.includes('/wood/') ? 'wood' : 'mice';
    if (url.endsWith('/integration')) return response({ domain_key: key, vapid_public_key: 'public-key', sender_api_key: `sender-${key}` });
    if (options?.method === 'PUT') zones[key] = JSON.parse(options.body).time_zone;
    return response({ domain_key: key, domain_name: domains.find(domain => domain.domain_key === key).domain_name, time_zone: zones[key] });
  });
});

test('renders the six reference cards with real web-push data and masked sender credentials', async () => {
  const configure = jest.fn();
  render(<Settings selectedDomainKey="mice" onConfiguration={configure} />);
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toBeEnabled());
  for (const heading of ['General Setting', 'Push Sending Settings', 'iOS Push Settings', 'Android Push Settings', 'Mailchimp Setting', 'Email Settings']) expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  expect(screen.getByLabelText('Public Key')).toHaveValue('public-key');
  expect(screen.getByLabelText('Sender API Key')).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Show', exact: true }));
  expect(screen.getByLabelText('Sender API Key')).toHaveAttribute('type', 'text');
  expect(screen.getByLabelText('Private Key')).toHaveValue('Managed securely on the server');
  fireEvent.click(screen.getByRole('button', { name: 'Open Configuration' }));
  expect(configure).toHaveBeenCalledWith('mice', 'micetraveladvisor.com');
});

test('saves the selected website time zone and reloads the saved value', async () => {
  const first = render(<Settings selectedDomainKey="mice" />);
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Time Zone'), { target: { value: 'America/New_York' } });
  fireEvent.click(within(screen.getByRole('region', { name: 'General Setting' })).getByRole('button', { name: 'Update', exact: true }));
  expect(await screen.findByText('General settings updated.')).toBeInTheDocument();
  expect(apiFetch).toHaveBeenCalledWith('https://api.example.test/api/domains/mice/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time_zone: 'America/New_York' }) });
  expect(zones.wood).toBe('Europe/London');
  first.unmount();
  render(<Settings selectedDomainKey="mice" />);
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toHaveValue('America/New_York'));
});

test('unsupported email and native integrations remain disabled and cannot submit credentials', async () => {
  render(<Settings selectedDomainKey="mice" />);
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toBeEnabled());
  for (const label of ['SMTP Password', 'Mailchimp API Key', 'Key (.p8 file)', 'Android Service Account']) expect(screen.getByLabelText(label)).toBeDisabled();
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send Test Email' })).toBeDisabled();
  expect(apiFetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

test('save errors preserve the chosen time zone and permit retry', async () => {
  render(<Settings selectedDomainKey="mice" />);
  const general = screen.getByRole('region', { name: 'General Setting' });
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Time Zone'), { target: { value: 'UTC' } });
  apiFetch.mockResolvedValueOnce(response(null, false, 'Save failed'));
  fireEvent.click(within(general).getByRole('button', { name: 'Update', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(screen.getByLabelText('Time Zone')).toHaveValue('UTC');
  fireEvent.click(within(general).getByRole('button', { name: 'Update', exact: true }));
  expect(await screen.findByText('General settings updated.')).toBeInTheDocument();
});

test('switching websites loads the other time zone and resets sender-key visibility', async () => {
  const select = jest.fn();
  const { rerender } = render(<Settings selectedDomainKey="mice" onSelectDomain={select} />);
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Show', exact: true }));
  fireEvent.change(screen.getByLabelText('Select website'), { target: { value: 'wood' } });
  expect(select).toHaveBeenCalledWith('wood', 'woodandpanel.com');
  rerender(<Settings selectedDomainKey="wood" onSelectDomain={select} />);
  await waitFor(() => expect(screen.getByLabelText('Time Zone')).toHaveValue('Europe/London'));
  expect(screen.getByLabelText('Sender API Key')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Sender API Key')).toHaveValue('sender-wood');
});
