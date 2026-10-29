import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AudienceMap from './AudienceMap';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
const data = { countries: [{ code: 'IN', name: 'India', subscribers: 4 }, { code: 'US', name: 'United States', subscribers: 2 }], located: 6, unknown: 1, total: 7 };
const response = value => ({ ok: true, json: async () => ({ ok: true, data: value }) });
beforeEach(() => { jest.resetAllMocks(); apiFetch.mockResolvedValue(response(data)); });

test('shades real country counts and View All links to Analytics in a new tab', async () => {
  render(<AudienceMap domainKey="mice" />);
  const india = await screen.findByRole('img', { name: 'India: 4 located subscriptions' });
  expect(india).toHaveAttribute('fill', '#168b8e');
  expect(screen.getByRole('img', { name: 'United States: 2 located subscriptions' })).toHaveAttribute('fill', '#63adb0');
  expect(screen.getByRole('img', { name: 'France: 0 located subscriptions' })).toHaveAttribute('fill', '#d8dcdf');
  expect(screen.getByText(/Location unknown for 1 subscription/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'View All (opens in a new tab)' });
  expect(link).toHaveAttribute('href', '/analytics?domain=mice');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(apiFetch).toHaveBeenCalledWith('https://api.example.test/api/domains/mice/audience');
});

test('map supports bounded zoom, keyboard pan and reset without browser page navigation', async () => {
  render(<AudienceMap domainKey="mice" />); await screen.findByRole('img', { name: 'India: 4 located subscriptions' });
  const map = screen.getByRole('group', { name: 'World map of audience countries' });
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(map).toHaveAttribute('viewBox', '225 115 450 230');
  fireEvent.keyDown(map, { key: 'ArrowRight' }); expect(map).toHaveAttribute('viewBox', '260 115 450 230');
  fireEvent.click(screen.getByRole('button', { name: 'Reset' })); expect(map).toHaveAttribute('viewBox', '0 0 900 460');
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
});

test('unknown legacy subscriptions and empty audiences never produce example country shading', async () => {
  apiFetch.mockResolvedValue(response({ countries: [], located: 0, unknown: 7, total: 7 }));
  const { rerender } = render(<AudienceMap domainKey="mice" />);
  await screen.findByText(/Country locations will appear/);
  expect(document.querySelectorAll('path[fill="#168b8e"]')).toHaveLength(0);
  apiFetch.mockResolvedValue(response({ countries: [], located: 0, unknown: 0, total: 0 }));
  rerender(<AudienceMap domainKey="mice" refresh={1} />);
  await screen.findByText(/No subscriptions yet/);
  expect(document.querySelectorAll('path[fill="#168b8e"]')).toHaveLength(0);
});

test('failed country requests retry and refresh does not reuse a previous website audience', async () => {
  apiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Country data unavailable' }) });
  const { rerender } = render(<AudienceMap domainKey="mice" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Country data unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('img', { name: 'India: 4 located subscriptions' });
  apiFetch.mockResolvedValue(response({ countries: [{ code: 'GB', name: 'United Kingdom', subscribers: 2 }], located: 2, unknown: 0, total: 2 }));
  rerender(<AudienceMap domainKey="second" />);
  await screen.findByRole('img', { name: 'United Kingdom: 2 located subscriptions' });
  await waitFor(() => expect(screen.getByRole('img', { name: 'India: 0 located subscriptions' })).toHaveAttribute('fill', '#d8dcdf'));
});
