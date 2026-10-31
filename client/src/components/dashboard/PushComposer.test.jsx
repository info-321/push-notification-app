import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PushComposer, { validatePushDraft } from './PushComposer';
import { apiFetch } from '../../api';

jest.mock('../../api', () => ({ API_BASE: 'https://api.example.test', apiFetch: jest.fn() }));
const domains = [{ domain_key: 'mice', domain_name: 'micetraveladvisor.com' }, { domain_key: 'second', domain_name: 'second.test' }];
const response = (data, extra = {}) => ({ ok: true, json: async () => ({ ok: true, data, ...extra }) });
beforeEach(() => {
  jest.resetAllMocks();
  apiFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'POST') return response(null, { message: 'Accepted by push services: 2. Failed: 0. Expired subscriptions removed: 0.' });
    if (url.includes('/send-audience?')) return response({ matching: 2, total: 3, device_unknown: 1 });
    if (url.endsWith('/push-defaults')) return response({ icon: '', banner: { enabled: false, image: '', actions: [{ title: 'Read More', url: '', type: 'link' }] } });
    return response(domains);
  });
});
async function compose() {
  render(<PushComposer domainKey="mice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create New Push' }));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Travel news' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Read the latest story.' } });
}

test('the three-step flow previews the message, preserves Back edits and sends only after the final explicit action', async () => {
  await compose();
  expect(within(screen.getByRole('region', { name: 'Notification preview' })).getByText('Travel news')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'MacOS' }));
  expect(screen.getByRole('tab', { name: 'MacOS' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Choose Audience');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send Push Now' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
  expect(screen.getByLabelText('Title')).toHaveValue('Travel news');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send Push Now' })).toBeEnabled());
  expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Send Push Now' }));
  await screen.findByRole('button', { name: 'Create another notification' });
  const posts = apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0][0]).toBe('https://api.example.test/api/notifications/compose');
  expect(JSON.parse(posts[0][1].body)).toEqual({ domain_key: 'mice', title: 'Travel news', body: 'Read the latest story.', url: '/', icon: '', audience: { platform: 'all', subscribed: 'all' } });
});

test('platform and date filters update matching counts and the exact submitted audience across selected websites', async () => {
  await compose(); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Select All' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Audience platform' })).getByRole('button', { name: 'Desktop' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Subscription period' })).getByRole('button', { name: '7 days' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('https://api.example.test/api/domains/second/send-audience?platform=desktop&subscribed=7d'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send Push Now' })).toBeEnabled());
  expect(screen.getByText(/unknown device types and are excluded/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send Push Now' }));
  await screen.findByRole('button', { name: 'Create another notification' });
  const posts = apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options.body));
  expect(posts.map(post => post.domain_key)).toEqual(['mice', 'second']);
  expect(posts.every(post => post.audience.platform === 'desktop' && post.audience.subscribed === '7d')).toBe(true);
});

test('invalid links stop progression and unavailable choices cannot pretend to schedule, import or use native apps', async () => {
  await compose();
  fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://unrelated.test/article' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Use an HTTPS link on the selected website');
  expect(screen.getByRole('button', { name: 'Schedule One Time' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Schedule Recurring' })).toBeDisabled();
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('zero matching audiences and disabled web subscriptions never fall back to sending to everyone', async () => {
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((url, options) => url.includes('/send-audience?') ? Promise.resolve(response({ matching: 0, total: 3, device_unknown: 3 })) : original(url, options));
  await compose(); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Choose Audience');
  await waitFor(() => expect(screen.getByText('0', { selector: 'strong' })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Send Push Now' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Send to Web Subscribers' }));
  expect(screen.getByRole('button', { name: 'Send Push Now' })).toBeDisabled();
  expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('repeated clicks and uncertain network outcomes do not automatically resend a notification', async () => {
  let fail;
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((url, options) => options?.method === 'POST' ? new Promise((resolve, reject) => { fail = reject; }) : original(url, options));
  await compose(); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const button = await screen.findByRole('button', { name: 'Send Push Now' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button); fireEvent.click(button);
  expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  fail(new Error('network disconnected'));
  await screen.findByRole('button', { name: 'Create another notification' });
  expect(screen.getByText(/send status could not be confirmed/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send Push Now' })).not.toBeInTheDocument();
});

test('link validation supports multiple own websites using relative paths and rejects credentials or non-HTTPS icons', () => {
  const draft = { title: 'News', body: '', url: '/article', icon: '' };
  expect(validatePushDraft(draft, domains)).toBe('');
  expect(validatePushDraft({ ...draft, url: 'https://www.micetraveladvisor.com/article' }, [domains[0]])).toBe('');
  for (const url of ['//unrelated.test/article', 'javascript:alert(1)', 'https://user:password@micetraveladvisor.com/']) expect(validatePushDraft({ ...draft, url }, [domains[0]])).not.toBe('');
  expect(validatePushDraft({ ...draft, icon: 'data:image/png;base64,abc' }, domains)).not.toBe('');
});

test('icon defaults load per website, survive another notification and reload, and Reset persists', async () => {
  const defaults = { mice: { icon: 'https://cdn.test/saved-icon.png' }, second: { icon: 'https://cdn.test/second.png' } };
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((url, options) => {
    if (url.endsWith('/push-defaults')) {
      const key = url.includes('/second/') ? 'second' : 'mice';
      if (options?.method === 'PATCH') Object.assign(defaults[key], JSON.parse(options.body));
      return Promise.resolve(response(defaults[key]));
    }
    return original(url, options);
  });
  const view = render(<PushComposer domainKey="mice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create New Push' }));
  expect(screen.getByLabelText('Icon')).toHaveValue('https://cdn.test/saved-icon.png');
  fireEvent.change(screen.getByLabelText('Icon'), { target: { value: 'https://cdn.test/new.png' } });
  fireEvent.blur(screen.getByLabelText('Icon'));
  await waitFor(() => expect(defaults.mice.icon).toBe('https://cdn.test/new.png'));
  view.unmount();
  const second = render(<PushComposer domainKey="second" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create New Push' }));
  expect(screen.getByLabelText('Icon')).toHaveValue('https://cdn.test/second.png'); second.unmount();
  render(<PushComposer domainKey="mice" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create New Push' }));
  expect(screen.getByLabelText('Icon')).toHaveValue('https://cdn.test/new.png');
  fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));
  await waitFor(() => expect(defaults.mice.icon).toBe(''));
});

test('banner controls preview images and two buttons, save defaults without sending, and submit the selected banner', async () => {
  await compose();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Banner Settings (Optional)' }));
  fireEvent.change(screen.getByLabelText('Image', { exact: true }), { target: { value: 'https://cdn.test/banner.png' } });
  expect(screen.getByAltText('Banner preview')).toHaveAttribute('src', 'https://cdn.test/banner.png');
  fireEvent.change(screen.getByLabelText('Button 1 URL'), { target: { value: '/article' } });
  fireEvent.click(screen.getByRole('button', { name: '+ Add Button' }));
  fireEvent.change(screen.getByLabelText('Button 2', { exact: true }), { target: { value: 'Share' } });
  const sharing = screen.getAllByRole('checkbox', { name: 'Social media sharing / Click to call' });
  fireEvent.click(sharing[1]);
  expect(screen.getByLabelText('Button 2 action')).toHaveValue('facebook');
  expect(screen.queryByRole('button', { name: '+ Add Button' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Set above values as default' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Choose Audience');
  const patches = apiFetch.mock.calls.filter(([, options]) => options?.method === 'PATCH');
  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0][1].body).banner).toMatchObject({ enabled: true, image: 'https://cdn.test/banner.png', actions: [{ title: 'Read More', url: '/article', type: 'link' }, { title: 'Share', url: '', type: 'facebook' }] });
  expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send Push Now' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send Push Now' }));
  await screen.findByRole('button', { name: 'Create another notification' });
  const post = JSON.parse(apiFetch.mock.calls.find(([, options]) => options?.method === 'POST')[1].body);
  expect(post.banner.image).toBe('https://cdn.test/banner.png'); expect(post.banner.actions).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Create another notification' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create New Push' }));
  expect(screen.getByLabelText('Image', { exact: true })).toHaveValue('https://cdn.test/banner.png');
});

test('failed defaults saves block progression, and invalid button URLs cannot reach the audience step', async () => {
  await compose();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Banner Settings (Optional)' }));
  fireEvent.change(screen.getByLabelText('Button 1 URL'), { target: { value: 'https://evil.test/' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Button links must use HTTPS');
  fireEvent.change(screen.getByLabelText('Button 1 URL'), { target: { value: '/' } });
  fireEvent.change(screen.getByLabelText('Icon'), { target: { value: 'https://cdn.test/new.png' } });
  const original = apiFetch.getMockImplementation();
  apiFetch.mockImplementation((url, options) => options?.method === 'PATCH' ? Promise.reject(new Error('offline')) : original(url, options));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the icon');
  expect(screen.queryByText('Choose Audience')).not.toBeInTheDocument();
});
