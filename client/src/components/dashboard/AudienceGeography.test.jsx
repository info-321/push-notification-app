import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AudienceGeography from './AudienceGeography';

const audience = {
  countries: [{ code: 'IN', name: 'India', subscribers: 5 }], located: 5, unknown: 2, total: 7,
  states: [{ code: 'WB', name: 'West Bengal', country_code: 'IN', country_name: 'India', subscribers: 4 }], state_located: 4, state_unknown: 3,
  cities: [{ name: 'Kolkata', region_name: 'West Bengal', region_code: 'WB', country_code: 'IN', country_name: 'India', subscribers: 3 }], city_located: 3, city_unknown: 4,
};

test('Country, State and City tabs show real counts and geographic context', () => {
  render(<AudienceGeography audience={audience} />);
  expect(screen.getByRole('tab', { name: 'Country' })).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('table', { name: 'Audience by country' })).getByText('India')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'State' }));
  expect(screen.getByRole('tab', { name: 'State' })).toHaveAttribute('aria-selected', 'true');
  const states = screen.getByRole('table', { name: 'Audience by state' });
  expect(within(states).getByRole('row', { name: '1 West Bengal India 4' })).toBeInTheDocument();
  expect(within(states).getByRole('row', { name: '— Location unknown — 3' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'City' }));
  const cities = screen.getByRole('table', { name: 'Audience by city' });
  expect(within(cities).getByRole('row', { name: '1 Kolkata West Bengal India 3' })).toBeInTheDocument();
  expect(within(cities).getByRole('row', { name: '— Location unknown — — 4' })).toBeInTheDocument();
});

test('geography tabs support arrow keys and roving focus', () => {
  render(<AudienceGeography audience={audience} />);
  screen.getByRole('tab', { name: 'Country' }).focus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Country' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'State' })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: 'State' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'State' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'City' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'City' }), { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'Country' })).toHaveFocus();
});

test('legacy subscriptions stay unknown and empty audiences stay empty without example locations', () => {
  const { rerender } = render(<AudienceGeography audience={{ countries: [], total: 8, unknown: 8, states: [], state_unknown: 8, cities: [], city_unknown: 8 }} />);
  fireEvent.click(screen.getByRole('tab', { name: 'City' }));
  expect(screen.getByRole('row', { name: '— Location unknown — — 8' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Setup instructions' })).toHaveAttribute('href', 'https://developers.cloudflare.com/rules/transform/managed-transforms/configure/');
  expect(screen.queryByText('Kolkata')).not.toBeInTheDocument();
  rerender(<AudienceGeography audience={{ countries: [], total: 0, unknown: 0, states: [], state_unknown: 0, cities: [], city_unknown: 0 }} />);
  expect(screen.getByText('No subscribers yet.')).toBeInTheDocument();
  expect(screen.queryByText('Location unknown')).not.toBeInTheDocument();
});
