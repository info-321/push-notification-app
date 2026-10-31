import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PromptSettings from './PromptSettings';
import { apiFetch } from '../../api';
jest.mock('../../api', () => ({ API_BASE: 'https://api.test', apiFetch: jest.fn() }));
const settings = { enabled: true, template: 'slide-in', heading: 'Stay updated', message: 'Get travel news.', allow_label: 'Enable notifications', dismiss_label: 'Maybe later', logo: '', accent: '#12ad88', background: '#ffffff', text: '#25394b', position: 'right', trigger: 'delay', delay: 15, scroll: 50, cooldown: 7, include_paths: [], exclude_paths: [] };
let state;
beforeEach(() => {
  state = { version: '0', draft: { ...settings }, published: null, previous: null }; jest.resetAllMocks();
  apiFetch.mockImplementation(async (url, options) => {
    let data;
    if (url.endsWith('/api/domains')) data = [{ domain_key: 'one', domain_name: 'website.test' }];
    else if (url.includes('/prompt-performance?')) data = { rows: [{ revision: '1', template: 'slide-in', views: 20, clicks: 5, dismissals: 2, subscriptions: 3 }] };
    else {
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body); state = { ...state, version: String(Number(state.version) + 1), draft: body.settings };
        if (body.operation === 'publish') { state.previous = state.published; state.published = { settings: body.settings, revision: state.version, published_at: new Date().toISOString() }; }
      }
      data = state;
    }
    return { ok: true, json: async () => ({ ok: true, data }) };
  });
});
test('draft editing and previews never publish until the explicit publish action; mobile stays separate', async () => {
  render(<PromptSettings domainKey="one" />);
  fireEvent.change(await screen.findByLabelText('Heading', { exact: true }), { target: { value: 'Travel updates' } });
  expect(within(screen.getByRole('region', { name: 'Subscription prompt preview' })).getByText('Travel updates')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tablet', exact: true }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Subscription prompt preview' })).getByRole('button', { name: 'Enable notifications', exact: true }));
  expect(screen.getByText(/This preview does not request permission/)).toBeInTheDocument();
  expect(apiFetch.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
  await screen.findByText('Draft saved. The live website has not changed.'); expect(state.published).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mobile phones', exact: true }));
  expect(screen.getByRole('heading', { name: 'Mobile phone settings' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Heading', { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Desktop, laptop & tablet', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish to website' }));
  await screen.findByText(/Published for desktop, laptop and tablet/);
  expect(state.published.settings.heading).toBe('Travel updates');
  expect(apiFetch.mock.calls.filter(([, opts]) => opts?.method === 'POST').map(([, opts]) => JSON.parse(opts.body).operation)).toEqual(['save', 'publish']);
});
test('template selection, scrolling rules, empty paths and actual performance values work without native permission prompts', async () => {
  render(<PromptSettings domainKey="one" />);
  const button = await screen.findByRole('button', { name: /Floating button A compact/ });
  fireEvent.click(button); expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByLabelText('Heading', { exact: true })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Show the custom prompt'), { target: { value: 'scroll' } });
  expect(screen.getByLabelText('Scroll depth (%)')).toHaveValue(50);
  fireEvent.change(screen.getByLabelText('Show only on these paths (optional)'), { target: { value: '/news\n\n' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
  await waitFor(() => expect(state.draft.include_paths).toEqual(['/news']));
  const performance = screen.getByRole('region', { name: 'Prompt Performance' });
  expect(await within(performance).findByText('15.0%', { selector: 'strong' })).toBeInTheDocument();
  expect(within(performance).getByText(/comparisons are observational/i)).toBeInTheDocument();
});

test('the additional four templates have editable content, distinct previews and persistent draft selections', async () => {
  render(<PromptSettings domainKey="one" />);
  await screen.findByLabelText('Heading', { exact: true });
  for (const [template, name] of [['dialog', 'Dialog Box'], ['modal', 'Central Modal'], ['fullscreen', 'Full Screen Pop Up'], ['sticky', 'Sticky Bar']]) {
    const card = screen.getByRole('button', { name: new RegExp('^' + name) });
    fireEvent.click(card); expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Heading', { exact: true })).toHaveValue('Stay updated');
    if (template === 'sticky') {
      const edgeTab = screen.getByRole('button', { name: 'Enable notifications', exact: true });
      expect(edgeTab).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(edgeTab);
    }
    const preview = screen.getByRole('region', { name: 'Subscription prompt preview' });
    expect(preview).toHaveClass(template);
    fireEvent.click(within(preview).getByRole('button', { name: 'Enable notifications', exact: true }));
    expect(screen.getByText(/This preview does not request permission/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    await waitFor(() => expect(state.draft.template).toBe(template));
    await screen.findByText('Draft saved. The live website has not changed.');
    expect(state.published).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Mobile phones', exact: true }));
  expect(screen.queryByRole('button', { name: /^Central Modal/ })).not.toBeInTheDocument();
});
