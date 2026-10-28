import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ConfigurationPanel from './ConfigurationPanel';
import Domain from './Domain';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
const details = { domain_key: 'mice', domain_name: 'micetraveladvisor.com', vapid_public_key: 'test-public-key', sender_api_key: 'private-sender-not-for-visitor-scripts', api_base: 'https://api.example.test', service_url: 'https://api.example.test/api/notifications', live_ready: true };
const response = (data, ok = true, message) => ({ ok, json: async () => ({ ok, data, message }) });

beforeEach(() => {
  jest.resetAllMocks();
  window.history.replaceState({}, '', '/settings/config?domain=mice');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  apiFetch.mockImplementation(async url => response(url.includes('/integration') ? details : [details, { domain_key: 'second', domain_name: 'second.example.com' }]));
});

test('configuration starts with collapsed installation rows and never sends on load', async () => {
  render(<ConfigurationPanel domainKey="mice" />);
  expect(await screen.findByText('micetraveladvisor.com')).toBeInTheDocument();
  for (const label of ['Install With Script', 'Install WordPress Plugin']) expect(screen.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: 'Download WordPress Plugin' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pop ups' })).toBeDisabled();
  expect(apiFetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

test('script and WordPress accordions switch independently and copy the correct public or administrator values', async () => {
  render(<ConfigurationPanel domainKey="mice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install With Script', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy script', exact: true }));
  await screen.findByText('Script copied.');
  const snippet = navigator.clipboard.writeText.mock.calls[0][0];
  expect(snippet).toContain('test-public-key'); expect(snippet).toContain('"domainKey": "mice"');
  expect(snippet).not.toContain(details.sender_api_key);
  expect(screen.getByRole('link', { name: 'Download push-sw.js' })).toHaveAttribute('href', 'https://api.example.test/push-sw.js');
  fireEvent.click(screen.getByRole('button', { name: 'Install WordPress Plugin', exact: true }));
  expect(screen.getByRole('button', { name: 'Install With Script', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Copy script', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download WordPress Plugin' })).toHaveAttribute('href', 'https://api.example.test/downloads/push-notifications-plugin.zip?v=1.1.1');
  expect(screen.getByLabelText('Sender API Key')).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Show', exact: true }));
  expect(screen.getByLabelText('Sender API Key')).toHaveAttribute('type', 'text');
  fireEvent.click(screen.getByRole('button', { name: 'Copy Sender API Key' }));
  await screen.findByText('Sender API Key copied.');
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(details.sender_api_key);
});

test('a test notification requires submit and uses the selected domain and entered content', async () => {
  render(<ConfigurationPanel domainKey="mice" />); await screen.findByText('micetraveladvisor.com');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'MICE test' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Testing layout' } });
  apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'Accepted by push services: 7. Failed: 0. Expired subscriptions removed: 0.' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Send test notification', exact: true }));
  expect(await screen.findByText(/Accepted by push services: 7/)).toBeInTheDocument();
  expect(apiFetch).toHaveBeenLastCalledWith('https://api.example.test/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain_key: 'mice', title: 'MICE test', body: 'Testing layout', url: '/' }) });
});

test('failed configuration loads can retry and failed sends show an error without claiming success', async () => {
  apiFetch.mockResolvedValueOnce(response(null, false, 'Configuration unavailable'));
  render(<ConfigurationPanel domainKey="mice" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Configuration unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('micetraveladvisor.com');
  apiFetch.mockResolvedValueOnce(response(null, false, 'Could not send notification'));
  fireEvent.click(screen.getByRole('button', { name: 'Send test notification', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send notification');
  expect(screen.getByRole('button', { name: 'Send test notification', exact: true })).toBeEnabled();
});

test('Send Push deep links focus the existing composer after configuration loads', async () => {
  window.history.replaceState({}, '', '/settings/config?domain=mice#send-push');
  const scroll = jest.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  render(<ConfigurationPanel domainKey="mice" />);
  await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus());
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
});

test('the domain wrapper keeps navigation working and clears expanded details when switching websites', async () => {
  const settings = jest.fn(), account = jest.fn(), domains = jest.fn();
  const { rerender } = render(<Domain selectedDomainKey="mice" defaultTab="config" onSettings={settings} onAccount={account} onDomains={domains} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install WordPress Plugin', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true })); expect(settings).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Account', exact: true })); expect(account).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Domain', exact: true })); expect(domains).toHaveBeenCalledTimes(1);
  apiFetch.mockResolvedValue(response({ ...details, domain_key: 'second', domain_name: 'second.example.com', sender_api_key: 'another-sender' }));
  rerender(<Domain selectedDomainKey="second" defaultTab="config" />);
  await screen.findByText('second.example.com', { selector: 'dd' });
  expect(screen.getByRole('button', { name: 'Install WordPress Plugin', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByLabelText('Sender API Key')).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Website configuration keys' })).getByText('second')).toBeInTheDocument();
});
