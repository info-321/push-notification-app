import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import BrowserChart from './BrowserChart';

test('percentages include unknown subscribers and accessible counts match the real distribution', () => {
  render(<BrowserChart total={4} browser={{ rows: [{ name: 'Chrome', subscribers: 2 }, { name: 'Firefox', subscribers: 1 }], unknown: 1 }} />);
  const table = screen.getByRole('table', { name: 'Subscriber browser counts' });
  expect(within(table).getByRole('row', { name: 'Chrome 2 50.0%' })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: 'Firefox 1 25.0%' })).toBeInTheDocument();
  expect(within(table).getByRole('row', { name: 'Unknown 1 25.0%' })).toBeInTheDocument();
  expect(screen.getByText(/Browser is unknown for 1 subscription/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'App Not tracked' })).toBeDisabled();
});

test('legend focus and selection expose browser counts and percentages without changing the totals', () => {
  render(<BrowserChart total={4} browser={{ rows: [{ name: 'Chrome', subscribers: 3 }, { name: 'Edge', subscribers: 1 }], unknown: 0 }} />);
  const edge = screen.getByRole('button', { name: 'Edge 25.0%' });
  fireEvent.focus(edge);
  expect(screen.getByRole('status')).toHaveTextContent('Edge');
  expect(screen.getByRole('status')).toHaveTextContent('1 subscriptions · 25.0%');
  expect(edge).toHaveAttribute('aria-pressed', 'true');
  fireEvent.blur(edge);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chrome 75.0%' }));
  expect(screen.getByRole('status')).toHaveTextContent('3 subscriptions · 75.0%');
  expect(screen.getByRole('row', { name: 'Chrome 3 75.0%' })).toBeInTheDocument();
});

test('a single browser is a full pie while an empty period shows no invented distribution', () => {
  const { rerender } = render(<BrowserChart total={8} browser={{ rows: [{ name: 'Chrome', subscribers: 8 }], unknown: 0 }} />);
  expect(screen.getByRole('img', { name: 'Subscriber browser distribution' })).toBeInTheDocument();
  expect(screen.getByText('Chrome: 100.0%')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Unknown/ })).not.toBeInTheDocument();
  rerender(<BrowserChart total={0} browser={{ rows: [], unknown: 0 }} />);
  expect(screen.getByText('No subscribers in this date range.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('old subscriptions remain visibly unknown until browsers revisit instead of assuming Chrome', () => {
  render(<BrowserChart total={8} browser={{ available: false, rows: [] }} />);
  expect(screen.getByRole('button', { name: 'Unknown 100.0%' })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: 'Chrome 0 0.0%' })).toBeInTheDocument();
  expect(screen.getByText(/Browser is unknown for 8 subscriptions/)).toBeInTheDocument();
});
