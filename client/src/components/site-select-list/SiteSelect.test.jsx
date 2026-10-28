import React from 'react';
import { render, screen } from '@testing-library/react';
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
