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
      : url.includes('/prompt-settings') ? { version: '0', published: null, previous: null, draft: { enabled: true, template: 'slide-in', heading: 'Stay updated', message: 'Get news', allow_label: 'Enable notifications', dismiss_label: 'Maybe later', logo: '', accent: '#12ad88', background: '#ffffff', text: '#25394b', position: 'right', trigger: 'delay', delay: 15, scroll: 50, cooldown: 7, include_paths: [], exclude_paths: [] } }
      : url.includes('/prompt-performance?') ? { rows: [] }
      : url.endsWith('/api/schedules/status') ? { running: true }
      : url.includes('/schedules?page=') ? { rows: [], page: 1, pages: 1, total: 0 }
      : url.endsWith('/push-defaults') ? { icon: '' }
      : url.endsWith('/pwa') ? { domain_key: 'mice-key', domain_name: domain.domain_name, saved: false, settings: { name: domain.display_name, short_name: 'MICE', start_url: 'https://micetraveladvisor.com/', theme_color: '#ffffff', background_color: '#ffffff', icon_192: '', icon_512: '' } }
      : url.endsWith('/settings')
      ? { ...domain, time_zone: 'Asia/Kolkata' }
      : url.endsWith('/integration') ? { ...domain, vapid_public_key: 'public-key', sender_api_key: 'test-sender' }
      : url.includes('/analytics?') ? { range: { start: '2024-01-01', end: '2024-01-01', time_zone: 'UTC' }, daily: [{ date: '2024-01-01', added: 7 }], added: 7, mobile: null, desktop: null, app: null, unsubscribed: null, net: null, browser: { available: false, rows: [] }, basis: 'Currently saved subscription records.' }
      : url.endsWith('/audience') ? { countries: [], located: 0, unknown: 7, total: 7, capture_available: false }
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
  expect(await screen.findByRole('heading', { name: 'Send Push for micetraveladvisor.com' })).toBeTruthy();
  expect(window.location.pathname + window.location.search).toBe('/push?domain=mice-key');
  fireEvent.click(screen.getByRole('button', { name: 'Configuration', exact: true }));
  expect(await screen.findByText('Configuration screen')).toBeTruthy();
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

test('PWA tab opens with the selected website and supports direct URLs and browser navigation', async () => {
  window.history.replaceState({}, '', '/settings?domain=mice-key');
  render(<App />);
  await screen.findByRole('heading', { name: 'General Setting' });
  fireEvent.click(screen.getByRole('button', { name: 'PWA Setting', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('Name *').value).toBe('MICE Travel Advisor'));
  expect(window.location.pathname + window.location.search).toBe('/settings/pwa?domain=mice-key');
  fireEvent.click(screen.getByRole('button', { name: 'Account', exact: true }));
  await screen.findByRole('heading', { name: 'Change Password' });
  window.history.replaceState({}, '', '/settings/pwa?domain=mice-key');
  fireEvent(window, new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.getByLabelText('Name *').value).toBe('MICE Travel Advisor'));
});


test('Analytics direct URLs restore the selected website despite stale view and support dashboard navigation', async () => {
  localStorage.setItem('view', 'domain');
  window.history.replaceState({}, '', '/analytics?domain=mice-key');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'MICE Travel Advisor Analytics' })).toBeTruthy();
  expect(screen.getByLabelText('Total Subscribers: 7')).toBeTruthy();
  expect(window.location.pathname + window.location.search).toBe('/analytics?domain=mice-key');
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard', exact: true }));
  await screen.findByRole('heading', { name: 'micetraveladvisor.com', exact: true });
  expect(window.location.pathname).toBe('/dashboard');
  window.history.replaceState({}, '', '/analytics?domain=mice-key');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(await screen.findByRole('heading', { name: 'MICE Travel Advisor Analytics' })).toBeTruthy();
});

test('Push Notification opens a dedicated new-tab URL and the composer restores its route on direct navigation', async () => {
  window.history.replaceState({}, '', '/dashboard?domain=mice-key');
  render(<App />);
  await screen.findByLabelText('Total Subscribers: 7');
  const menu = screen.getByRole('link', { name: 'Push Notification', exact: true });
  expect(menu.getAttribute('href')).toBe('/push?domain=mice-key');
  expect(menu.getAttribute('target')).toBe('_blank');
  expect(menu.getAttribute('rel')).toBe('noopener noreferrer');
  window.history.replaceState({}, '', '/push?domain=mice-key');
  fireEvent(window, new PopStateEvent('popstate'));
  expect(await screen.findByRole('button', { name: 'Create New Push' })).toBeTruthy();
  expect(window.location.pathname + window.location.search).toBe('/push?domain=mice-key');
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('Push Setting has a dedicated route with a separate mobile section and supports browser navigation', async () => {
  window.history.replaceState({}, '', '/push/settings?domain=mice-key');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Subscription Prompt', exact: true })).toBeTruthy();
  await screen.findByRole('button', { name: 'Publish to website' });
  expect(window.location.pathname).toBe('/push/settings');
  fireEvent.click(screen.getByRole('button', { name: 'Mobile phones', exact: true }));
  expect(screen.getByRole('heading', { name: 'Mobile phone settings' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: /^Native Opt-in/ })).toBeTruthy();
  window.history.replaceState({}, '', '/push?domain=mice-key'); fireEvent(window, new PopStateEvent('popstate'));
  await screen.findByRole('button', { name: 'Create New Push' });
  expect(screen.getByRole('link', { name: 'Push Setting', exact: true }).getAttribute('href')).toBe('/push/settings?domain=mice-key');
});

test('Schedule List survives a direct URL and browser navigation with the selected website', async () => {
  window.history.replaceState({}, '', '/push/schedules?domain=mice-key'); render(<App />);
  await screen.findByRole('heading', { name: 'Scheduled notifications' });
  expect(await screen.findByText(/No schedules yet/)).toBeTruthy();
  expect(window.location.pathname + window.location.search).toBe('/push/schedules?domain=mice-key');
  window.history.replaceState({}, '', '/push?domain=mice-key'); fireEvent(window, new PopStateEvent('popstate'));
  await screen.findByRole('button', { name: 'Create New Push' });
  expect(screen.getByRole('link', { name: 'Schedule List' }).getAttribute('href')).toBe('/push/schedules?domain=mice-key');
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
