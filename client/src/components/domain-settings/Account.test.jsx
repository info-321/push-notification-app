import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Account from './Account';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
const profile = { username: 'owner@example.test', email: 'owner@example.test', status: 'Active', last_login_at: '2026-10-28T11:00:00Z', last_login_ip: '127.0.0.1' };
const response = (data, ok = true, message) => ({ ok, json: async () => ({ ok, data, message }) });
beforeEach(() => {
  localStorage.clear(); jest.resetAllMocks();
  apiFetch.mockImplementation(async url => response(url.endsWith('/api/account') ? profile : [{ domain_key: 'mice', domain_name: 'micetraveladvisor.com', time_zone: 'Asia/Kolkata' }]));
});

test('renders real account details with a hidden password and disabled administrator deletion', async () => {
  render(<Account selectedDomainKey="mice" />);
  expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
  expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
  expect(screen.getByLabelText('Password hidden')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeDisabled();
  expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
});

test('show/hide applies only to the new password', async () => {
  render(<Account />); await screen.findByText('owner@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Show new password' }));
  expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'text');
  expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Hide new password' }));
  expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'password');
});

test('successful password changes update the session token and clear the form', async () => {
  render(<Account />); await screen.findByText('owner@example.test');
  fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'current-password-123' } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'new-password-456' } });
  apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, token: 'replacement-token', message: 'Password changed.' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(await screen.findByText('Password changed.')).toBeInTheDocument();
  expect(localStorage.getItem('sessionToken')).toBe('replacement-token');
  expect(screen.getByLabelText('Current Password')).toHaveValue('');
  expect(screen.getByLabelText('New Password')).toHaveValue('');
  expect(apiFetch).toHaveBeenLastCalledWith('https://api.example.test/api/account/password', expect.objectContaining({ method: 'POST', body: JSON.stringify({ current_password: 'current-password-123', new_password: 'new-password-456' }) }));
});

test('incorrect current-password errors keep the form available for correction', async () => {
  render(<Account />); await screen.findByText('owner@example.test');
  fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'wrong' } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'new-password-456' } });
  apiFetch.mockResolvedValueOnce(response(null, false, 'Current password is incorrect.'));
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  expect(localStorage.getItem('sessionToken')).toBeNull();
});
