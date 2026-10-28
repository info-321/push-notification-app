import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DomainList from './DomainList';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));

const domains = [
  { id: 1, domain_key: 'mice', display_name: 'MICE Travel Advisor', domain_name: 'micetraveladvisor.com' },
  { id: 2, domain_key: 'wood', display_name: 'Wood and Panel', domain_name: 'woodandpanel.com' },
];
const response = (data, ok = true, message) => ({ ok, json: async () => ({ ok, data, message }) });
beforeEach(() => { jest.resetAllMocks(); apiFetch.mockResolvedValue(response(domains)); });
afterEach(() => jest.restoreAllMocks());

test('lists friendly names and hostnames, selects rows, and supports select all', async () => {
  render(<DomainList />);
  expect(await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete' }).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Select micetraveladvisor.com'));
  expect(screen.getByLabelText('Select all domains').indeterminate).toBe(true);
  fireEvent.click(screen.getByLabelText('Select all domains'));
  expect(screen.getByText('2 selected')).toBeTruthy();
  expect(screen.getByLabelText('Select woodandpanel.com').checked).toBe(true);
  fireEvent.click(screen.getByLabelText('Select all domains'));
  expect(screen.getByRole('button', { name: 'Delete' }).disabled).toBe(true);
});

test('New and Configuration navigate using the selected website', async () => {
  const onNew = jest.fn(), onConfiguration = jest.fn();
  render(<DomainList selectedDomainKey="wood" onNew={onNew} onConfiguration={onConfiguration} />);
  await screen.findByText('Wood and Panel');
  fireEvent.click(screen.getByRole('button', { name: 'New', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Configuration', exact: true }));
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(onConfiguration).toHaveBeenCalledWith('wood', 'woodandpanel.com');
});

test('Edit saves a name through PATCH, keeps the hostname read-only, and restores focus', async () => {
  render(<DomainList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Domain').readOnly).toBe(true);
  expect(document.activeElement).toBe(within(dialog).getByLabelText(/Name/));
  fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'MICE News' } });
  apiFetch.mockResolvedValueOnce(response({ ...domains[0], display_name: 'MICE News' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('button', { name: 'Edit MICE News' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(apiFetch).toHaveBeenLastCalledWith('https://api.example.test/api/domains/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'MICE News' }) });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit MICE News' }));
});

test('a failed save keeps the edit form and permits retry; Escape cancels without a write', async () => {
  render(<DomainList />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit MICE Travel Advisor' }));
  apiFetch.mockResolvedValueOnce(response(null, false, 'Could not save name'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not save name');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('bulk deletion retains failed rows and their selection so they can be retried', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  const onDeleted = jest.fn();
  render(<DomainList onDeleted={onDeleted} />);
  await screen.findByText('MICE Travel Advisor');
  fireEvent.click(screen.getByLabelText('Select all domains'));
  apiFetch.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(null, false, 'Database unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Wood and Panel: Database unavailable'));
  expect(screen.queryByRole('button', { name: 'Edit MICE Travel Advisor' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit Wood and Panel' })).toBeTruthy();
  expect(screen.getByLabelText('Select woodandpanel.com').checked).toBe(true);
  expect(onDeleted).toHaveBeenCalledWith(['mice']);
});

test('cancelled deletion does not call DELETE; loading errors can retry into an empty list', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  apiFetch.mockResolvedValueOnce(response(null, false, 'Could not load domains'));
  render(<DomainList />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Could not load domains'));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('MICE Travel Advisor');
  fireEvent.click(screen.getByLabelText('Select micetraveladvisor.com'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(0);
});
