import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { apiFetch } from './api';

jest.mock('./api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
jest.mock('./components/domain-settings/Domain', () => function MockConfiguration(props) {
  return <div><h1>Configuration screen</h1><span>{props.selectedDomainKey}</span><button onClick={props.onDashboard}>Return to dashboard</button></div>;
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth', 'true');
  localStorage.setItem('sessionToken', 'test-token');
  localStorage.setItem('domainSetupComplete', 'true');
  window.history.replaceState({}, '', '/dashboard');
  apiFetch.mockImplementation(async url => {
    const domain = { id: 1, domain_key: 'mice-key', display_name: 'MICE Travel Advisor', domain_name: 'micetraveladvisor.com', is_configured: true };
    return { ok: true, json: async () => ({ ok: true, data: url.endsWith('/api/account')
      ? { username: 'admin', email: null, status: 'Active', last_login_at: null, last_login_ip: null }
      : url.endsWith('/settings')
      ? { ...domain, time_zone: 'Asia/Kolkata' }
      : url.endsWith('/integration') ? { ...domain, vapid_public_key: 'public-key', sender_api_key: 'test-sender' }
      : url.endsWith('/overview')
      ? { domain, subscribers: { total: 7, web: 7, mobile: null, app: null }, updated_at: '2026-10-28T08:00:00Z' }
      : [domain] }) };
  });
});

test('domain card opens the overview, Send Push targets the composer, and Configuration can return', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open dashboard for micetraveladvisor.com' }));
  expect(await screen.findByLabelText('Total Subscribers: 7')).toBeTruthy();
  expect(window.location.pathname + window.location.search).toBe('/dashboard?domain=mice-key');
  fireEvent.click(screen.getByRole('button', { name: /Send Push/ }));
  expect(await screen.findByText('Configuration screen')).toBeTruthy();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/settings/config?domain=mice-key#send-push');
  fireEvent.click(screen.getByRole('button', { name: 'Return to dashboard' }));
  expect(await screen.findByLabelText('Total Subscribers: 7')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All websites', exact: true }));
  expect(await screen.findByText('Select Domain')).toBeTruthy();
});

test('a direct overview URL survives reload with stale persisted view and responds to browser navigation', async () => {
  localStorage.setItem('view', 'domain');
  window.history.replaceState({}, '', '/dashboard?domain=mice-key');
  render(<App />);
  expect(await screen.findByLabelText('Total Subscribers: 7')).toBeTruthy();
  expect(screen.queryByText('Configuration screen')).toBeNull();
  window.history.replaceState({}, '', '/dashboard');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(await screen.findByText('Select Domain')).toBeTruthy();
  window.history.replaceState({}, '', '/dashboard?domain=mice-key');
  fireEvent(window, new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.getByLabelText('Total Subscribers: 7')).toBeTruthy());
});

test('the domains settings URL survives reload and New opens the existing setup screen', async () => {
  window.history.replaceState({}, '', '/settings/domains');
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' })).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/domains');
  expect(screen.queryByText('Configuration screen')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New', exact: true }));
  expect(await screen.findByText('Configuration screen')).toBeTruthy();
});

test('Manage domains opens the table from an overview and supports browser Back', async () => {
  window.history.replaceState({}, '', '/dashboard?domain=mice-key');
  render(<App />);
  expect(await screen.findByLabelText('Total Subscribers: 7')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Manage domains' }));
  expect(await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' })).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/domains');
  window.history.replaceState({}, '', '/dashboard?domain=mice-key');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(await screen.findByLabelText('Total Subscribers: 7')).toBeTruthy();
});

test('the Settings URL survives reload and its Domain tab opens domain management', async () => {
  window.history.replaceState({}, '', '/settings?domain=mice-key');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'General Setting' })).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText('Time Zone').value).toBe('Asia/Kolkata'));
  expect(window.location.pathname + window.location.search).toBe('/settings?domain=mice-key');
  fireEvent.click(screen.getByRole('button', { name: 'Domain', exact: true }));
  expect(await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' })).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/domains');
});

test('Settings opens from the overview and Configuration retains the selected website', async () => {
  window.history.replaceState({}, '', '/dashboard?domain=mice-key');
  render(<App />);
  await screen.findByLabelText('Total Subscribers: 7');
  fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }));
  await screen.findByRole('heading', { name: 'Push Sending Settings' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open Configuration' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Open Configuration' }));
  expect(await screen.findByText('Configuration screen')).toBeTruthy();
  expect(window.location.search).toBe('?domain=mice-key');
});

test('Account opens from Settings and survives direct URL navigation', async () => {
  window.history.replaceState({}, '', '/settings?domain=mice-key');
  render(<App />);
  await screen.findByRole('heading', { name: 'General Setting' });
  fireEvent.click(screen.getByRole('button', { name: 'Account', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Change Password' })).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/account');
  expect(await screen.findByText('admin')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Domain', exact: true }));
  await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' });
  window.history.replaceState({}, '', '/settings/account?domain=mice-key');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(await screen.findByRole('heading', { name: 'Change Password' })).toBeTruthy();
});
