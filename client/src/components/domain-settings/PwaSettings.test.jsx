import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PwaSettings from './PwaSettings';
import { apiFetch } from '../../api';
import { readPwaIcon, downloadManifest } from './pwa-files';

jest.mock('../../api', () => ({ API_BASE: 'https://push.example.test', apiFetch: jest.fn() }));
jest.mock('./pwa-files', () => ({ ...jest.requireActual('./pwa-files'), readPwaIcon: jest.fn(), downloadManifest: jest.fn() }));
const initial = { name: 'MICE Travel Advisor', short_name: 'MICE', start_url: 'https://www.micetraveladvisor.com/', theme_color: '#ffffff', background_color: '#ffffff', icon_192: '', icon_512: '' };
const domains = [{ id: 1, domain_key: 'mice', domain_name: 'micetraveladvisor.com' }, { id: 2, domain_key: 'second', domain_name: 'second.test' }];
const response = (data, ok = true, message) => ({ ok, json: async () => ({ ok, data, message }) });
let records;
beforeEach(() => {
  jest.resetAllMocks(); records = { mice: null, second: null };
  apiFetch.mockImplementation(async (url, options) => {
    if (url.endsWith('/api/domains')) return response(domains);
    const key = url.includes('/second/') ? 'second' : 'mice';
    if (options?.method === 'PUT') records[key] = JSON.parse(options.body);
    return response({ domain_key: key, domain_name: domains.find(item => item.domain_key === key).domain_name, settings: records[key] || { ...initial, ...(key === 'second' ? { name: 'Second Website', start_url: 'https://second.test/' } : {}) }, saved: Boolean(records[key]) });
  });
  readPwaIcon.mockImplementation(async (_, size) => `data:image/png;base64,mock${size}`);
});

test('loads website defaults with live name, color and URL previews and no automatic writes', async () => {
  render(<PwaSettings selectedDomainKey="mice" />);
  await waitFor(() => expect(screen.getByLabelText('Name *')).toHaveValue(initial.name));
  expect(screen.getByRole('button', { name: 'Download push-pwa-manifest.json' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'MICE News' } });
  fireEvent.change(screen.getByLabelText('Short Name *'), { target: { value: 'Travel news' } });
  fireEvent.change(screen.getByLabelText('Theme Color'), { target: { value: '#123abc' } });
  expect(within(screen.getByRole('region', { name: 'Preview - Step 1' })).getByText('Travel news')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Preview - Step 2' })).getByText('MICE News')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Preview - Step 2' })).getByText('www.micetraveladvisor.com')).toBeInTheDocument();
  expect(document.querySelector('.pwa-phone-toolbar')).toHaveStyle({ backgroundColor: '#123abc' });
  expect(apiFetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

test('uploads both PNGs, saves them for the selected website and downloads only the saved manifest', async () => {
  render(<PwaSettings selectedDomainKey="mice" />); await waitFor(() => expect(screen.getByLabelText('Name *')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose both required PNG icons');
  for (const size of [192, 512]) fireEvent.change(screen.getByLabelText(`Icon (${size}x${size}) *`), { target: { files: [new File(['png'], `icon-${size}.png`, { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true }));
  await screen.findByText(/PWA settings saved/);
  expect(records.second).toBeNull(); expect(records.mice.icon_512).toBe('data:image/png;base64,mock512');
  fireEvent.click(screen.getByRole('button', { name: 'Download push-pwa-manifest.json' }));
  expect(downloadManifest).toHaveBeenCalledWith(expect.objectContaining({ name: initial.name, start_url: initial.start_url, scope: 'https://www.micetraveladvisor.com/', display: 'standalone', icons: [
    { src: 'https://push.example.test/api/pwa/mice/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'https://push.example.test/api/pwa/mice/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ] }));
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Unsaved' } });
  expect(screen.getByRole('button', { name: 'Download push-pwa-manifest.json' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Download push-sw.js' })).toHaveAttribute('href', 'https://push.example.test/push-sw.js');
});

test('saved settings and icon previews survive reloading', async () => {
  records.mice = { ...initial, icon_192: 'data:image/png;base64,saved192', icon_512: 'data:image/png;base64,saved512' };
  const first = render(<PwaSettings selectedDomainKey="mice" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download push-pwa-manifest.json' })).toBeEnabled());
  first.unmount(); render(<PwaSettings selectedDomainKey="mice" />);
  expect(await screen.findByAltText('Selected 192 pixel icon')).toHaveAttribute('src', records.mice.icon_192);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download push-pwa-manifest.json' })).toBeEnabled());
});

test('invalid PNGs block updating and server failures keep the form retryable', async () => {
  records.mice = { ...initial, icon_192: 'data:image/png;base64,saved192', icon_512: 'data:image/png;base64,saved512' };
  render(<PwaSettings selectedDomainKey="mice" />); await waitFor(() => expect(screen.getByLabelText('Name *')).toBeEnabled());
  readPwaIcon.mockRejectedValueOnce(new Error('Choose an icon exactly 192 x 192 pixels.'));
  fireEvent.change(screen.getByLabelText('Icon (192x192) *'), { target: { files: [new File(['bad'], 'wrong.png', { type: 'image/png' })] } });
  await screen.findByText('Choose an icon exactly 192 x 192 pixels.');
  expect(screen.getByRole('button', { name: 'Update', exact: true })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Icon (192x192) *'), { target: { files: [new File(['good'], 'good.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update', exact: true })).toBeEnabled());
  apiFetch.mockResolvedValueOnce(response(null, false, 'Storage unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(screen.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
});

test('switching websites discards the previous draft and resets saved downloads', async () => {
  const select = jest.fn();
  const { rerender } = render(<PwaSettings selectedDomainKey="mice" onSelectDomain={select} />);
  await waitFor(() => expect(screen.getByLabelText('Name *')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Old draft' } });
  fireEvent.change(screen.getByLabelText('Select website'), { target: { value: 'second' } });
  expect(select).toHaveBeenCalledWith('second', 'second.test');
  rerender(<PwaSettings selectedDomainKey="second" onSelectDomain={select} />);
  await waitFor(() => expect(screen.getByLabelText('Name *')).toHaveValue('Second Website'));
  expect(screen.getByRole('button', { name: 'Download push-pwa-manifest.json' })).toBeDisabled();
});
