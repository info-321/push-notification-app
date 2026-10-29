import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SubscriberChart from './SubscriberChart';

const daily = [{ date: '2026-10-01', added: 3 }, { date: '2026-10-02', added: 0 }, { date: '2026-10-03', added: 8 }];

test('keyboard inspection shows the real day and count, including zero and range boundaries', () => {
  render(<SubscriberChart daily={daily} />);
  const chart = screen.getByRole('img', { name: 'Saved subscriptions added per day' });
  fireEvent.focus(chart);
  expect(screen.getByRole('status')).toHaveTextContent('01 Oct 26');
  expect(screen.getByRole('status')).toHaveTextContent('Total Subs: 3');
  fireEvent.keyDown(chart, { key: 'ArrowRight' });
  expect(screen.getByRole('status')).toHaveTextContent('02 Oct 26');
  expect(screen.getByRole('status')).toHaveTextContent('Total Subs: 0');
  fireEvent.keyDown(chart, { key: 'End' });
  fireEvent.keyDown(chart, { key: 'ArrowRight' });
  expect(screen.getByRole('status')).toHaveTextContent('03 Oct 26');
  expect(screen.getByRole('status')).toHaveTextContent('Total Subs: 8');
  fireEvent.keyDown(chart, { key: 'Home' });
  fireEvent.keyDown(chart, { key: 'ArrowLeft' });
  expect(screen.getByRole('status')).toHaveTextContent('Total Subs: 3');
  fireEvent.blur(chart);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('legend toggles recorded totals and identifies missing device and unsubscribe data', () => {
  render(<SubscriberChart daily={daily} />);
  for (const label of ['App Subs', 'Desktop Subs', 'Mobile Subs', 'Unsubscribers']) {
    expect(screen.getByRole('button', { name: `${label} (Not recorded)` })).toBeDisabled();
  }
  const total = screen.getByRole('button', { name: 'Total Subs', exact: true });
  expect(total).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(total);
  expect(total).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText(/Total Subs hidden/)).toBeInTheDocument();
  fireEvent.click(total);
  expect(total).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText(/Total Subs hidden/)).not.toBeInTheDocument();
});

test('a one-day zero report remains inspectable and missing dates use an empty state', () => {
  const { rerender } = render(<SubscriberChart daily={[daily[1]]} />);
  const chart = screen.getByRole('img', { name: 'Saved subscriptions added per day' });
  fireEvent.focus(chart);
  fireEvent.keyDown(chart, { key: 'End' });
  expect(screen.getByRole('status')).toHaveTextContent('Total Subs: 0');
  rerender(<SubscriberChart daily={[]} />);
  expect(screen.getByText('No saved subscription dates are available.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
