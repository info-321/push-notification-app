import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import TargetingSettings from './TargetingSettings';
import { apiFetch } from '../../api';
jest.mock('../../api', () => ({ API_BASE: 'https://api.test', apiFetch: jest.fn() }));
let stored;
beforeEach(() => {
  jest.resetAllMocks(); stored = { mode: 'all', devices: [], browsers: [], version: 0 };
  apiFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'PUT') { const body = JSON.parse(options.body); stored = { ...body.policy, version: body.version + 1 }; }
    return { ok: true, json: async () => ({ ok: true, data: stored }) };
  });
});
test('Apple preset is explicit, saved independently and preserved when the settings page reloads', async () => {
  const view = render(<TargetingSettings domainKey="ttw" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Use Apple + Safari / Home Screen preset' }));
  expect(screen.getByLabelText('Audience access')).toHaveValue('selected');
  for (const label of ['Apple Mac desktop / laptop', 'Apple iPad', 'Apple iPhone', 'Safari', 'Apple Home Screen web app']) expect(screen.getByLabelText(label)).toBeChecked();
  for (const label of ['Windows desktop / laptop / tablet', 'Android phone', 'Google Chrome', 'Mozilla Firefox', 'Opera', 'Microsoft Edge']) expect(screen.getByLabelText(label)).not.toBeChecked();
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save device & browser rules' }));
  await screen.findByText('Device and browser rules saved for this website.');
  const put = apiFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(put[0]).toBe('https://api.test/api/domains/ttw/targeting');
  expect(JSON.parse(put[1].body)).toEqual({ version: 0, policy: { mode: 'selected', devices: ['mac', 'ipad', 'iphone'], browsers: ['Safari', 'home_screen'] } });
  view.unmount(); render(<TargetingSettings domainKey="ttw" />); await screen.findByLabelText('Audience access');
  expect(screen.getByLabelText('Apple iPhone')).toBeChecked(); expect(screen.getByLabelText('Google Chrome')).not.toBeChecked();
});
test('zero allowed combinations warns clearly, while a stale save keeps edits and requires reload', async () => {
  render(<TargetingSettings domainKey="ttw" />); await screen.findByLabelText('Audience access');
  fireEvent.change(screen.getByLabelText('Audience access'), { target: { value: 'selected' } });
  expect(screen.getByText(/Saving will stop new prompts/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Apple iPhone')); fireEvent.click(screen.getByLabelText('Apple Home Screen web app'));
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((url, options) => options?.method === 'PUT' ? Promise.resolve({ ok: false, json: async () => ({ ok: false, message: 'Rules changed in another tab. Reload before saving.' }) }) : original(url, options));
  fireEvent.click(screen.getByRole('button', { name: 'Save device & browser rules' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Rules changed in another tab');
  expect(screen.getByLabelText('Apple iPhone')).toBeChecked();
  expect(within(screen.getByRole('group', { name: 'Allowed browsers' })).getByLabelText('Apple Home Screen web app')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Reload targeting rules' }));
  await waitFor(() => expect(screen.getByLabelText('Audience access')).toHaveValue('all'));
});
