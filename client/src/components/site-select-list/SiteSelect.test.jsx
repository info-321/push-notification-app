import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SiteSelect from './SiteSelect';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({
  API_BASE: 'https://api.example.test',
  apiFetch: jest.fn(),
}));

function mockDomain(status, configured) {
  apiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      data: [{ id: 1, domain_name: 'micetraveladvisor.com', domain_key: 'test-domain', status, is_configured: configured }],
    }),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

test('a connected domain displays Configured despite pending ownership verification', async () => {
  mockDomain('pending', true);
  render(<SiteSelect />);
  expect(await screen.findByText('Configured')).toBeTruthy();
  expect(screen.queryByText('Not Configured')).toBeNull();
});

test('ownership verification alone does not display a working push integration', async () => {
  mockDomain('verified', false);
  render(<SiteSelect />);
  expect(await screen.findByText('Not Configured')).toBeTruthy();
  expect(screen.queryByText('Configured')).toBeNull();
});

test('the card and arrow open the same domain dashboard while its menu does not navigate', async () => {
  mockDomain('pending', true);
  const open = jest.fn();
  render(<SiteSelect onSelectDomain={open} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open dashboard for micetraveladvisor.com' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open domain' }));
  expect(open.mock.calls).toEqual([['test-domain', 'micetraveladvisor.com'], ['test-domain', 'micetraveladvisor.com']]);
  fireEvent.click(screen.getByRole('button', { name: 'Open domain menu' }));
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(2);
});
