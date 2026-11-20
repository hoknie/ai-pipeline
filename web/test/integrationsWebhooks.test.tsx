// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsGroup } from '../src/features/integrations/index.ts';

import {
  fakeApi,
  integrationsOverview,
  repositoryView,
  webhookDeliveryView,
  webhookView,
} from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

afterEach(() => cleanup());

const registry = [repositoryView('/work/app', { color: 'blue' })];

async function open(overrides: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({ webhooks: vi.fn(async () => [webhookView()]), ...overrides });
  render(
    <IntegrationsGroup
      api={api}
      registry={registry}
      tab="webhooks"
      leave={() => async () => undefined}
    />,
  );
  await screen.findByTestId('webhook-w1');
  return api;
}

describe('the webhooks of the page of integrations', () => {
  it('lists a webhook with its address without a query, its state and the command of the secret', async () => {
    await open();
    const row = screen.getByTestId('webhook-w1');
    expect(within(row).getByText('ci')).toBeTruthy();
    expect(within(row).getByText('https://ci.example.com/hook')).toBeTruthy();
    expect(row.textContent).not.toContain('token');
    expect(
      within(row).getByText('aip integration secret set w1 signing_secret --stdin'),
    ).toBeTruthy();
    expect(within(row).getByText('disabled')).toBeTruthy();
  });

  it('has no field for the secret and does not show the command once it is set', async () => {
    await open({ webhooks: vi.fn(async () => [webhookView({ secret: true, enabled: true })]) });
    const section = screen.getByRole('heading', { name: 'Webhooks' }).closest('section')!;
    expect(section.querySelector('input[type="password"]')).toBeNull();
    expect(within(section).queryByLabelText(/secret/i)).toBeNull();
    expect(within(section).queryByText(/aip integration secret set/)).toBeNull();
  });

  it('shows why a webhook switched itself off', async () => {
    await open({
      webhooks: vi.fn(async () => [
        webhookView({ disabledReason: '3 deliveries failed in a row', failureStreak: 3 }),
      ]),
    });
    expect(screen.getByText(/3 deliveries failed in a row/)).toBeTruthy();
  });

  it('keeps webhooks out of the cards of connections and of the subscription form', async () => {
    const overview = integrationsOverview();
    overview.connections.push({
      ...overview.connections[0]!,
      id: 'w1',
      kind: 'webhook',
      name: 'ci',
      params: { url: 'https://ci.example.com/hook' },
    });
    overview.types.push({
      kind: 'webhook',
      title: 'Outgoing webhook',
      params: [{ name: 'url', required: true, maxLength: 2048 }],
      secrets: [{ slot: 'signing_secret', required: true }],
      directions: ['outbound'],
      operations: [],
    });
    const api = fakeApi({ integrations: vi.fn(async () => overview) });
    render(
      <IntegrationsGroup
        api={api}
        registry={registry}
        tab="connections"
        leave={() => async () => undefined}
      />,
    );
    await screen.findByTestId('connection-c1');
    expect(screen.queryByTestId('connection-w1')).toBeNull();
  });

  it('creates a webhook for all projects with the events chosen', async () => {
    const api = await open();
    const form = screen.getByRole('form', { name: 'New webhook' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'deploy' } });
    fireEvent.change(within(form).getByLabelText('Address (URL)'), {
      target: { value: 'https://ci.example.com/deploy?token=abc' },
    });
    fireEvent.click(within(form).getByLabelText('Group failed'));
    fireEvent.click(within(form).getByRole('button', { name: 'Create webhook' }));
    await waitFor(() =>
      expect(api.webhookAdd).toHaveBeenCalledWith({
        name: 'deploy',
        url: 'https://ci.example.com/deploy?token=abc',
        events: ['question', 'failed'],
      }),
    );
  });

  it('switches, tests, changes the address and removes', async () => {
    const api = await open();
    const row = screen.getByTestId('webhook-w1');
    fireEvent.click(within(row).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(api.webhookEnabled).toHaveBeenCalledWith('w1', true));
    fireEvent.click(within(row).getByRole('button', { name: 'Send a test' }));
    await waitFor(() => expect(api.webhookTest).toHaveBeenCalledWith('w1'));
    expect(await within(row).findByText('The receiver answered 200')).toBeTruthy();
    fireEvent.change(within(row).getByLabelText('New address'), {
      target: { value: 'https://ci.example.com/new' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Change address' }));
    await waitFor(() =>
      expect(api.webhookEdit).toHaveBeenCalledWith('w1', { url: 'https://ci.example.com/new' }),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.webhookRemove).toHaveBeenCalledWith('w1'));
  });

  it('shows the attempts of a delivery and sends it again', async () => {
    const api = await open({ webhookLog: vi.fn(async () => [webhookDeliveryView()]) });
    const row = screen.getByTestId('webhook-w1');
    fireEvent.click(within(row).getByRole('button', { name: 'Journal' }));
    const delivery = await screen.findByTestId('delivery-5');
    expect(within(delivery).getByText('question.asked')).toBeTruthy();
    expect(within(delivery).getByText('msg_abc123')).toBeTruthy();
    expect(within(delivery).getByText('503')).toBeTruthy();
    expect(within(delivery).getByText('timeout')).toBeTruthy();
    expect(within(delivery).getByText('10000 ms')).toBeTruthy();
    expect(within(delivery).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(delivery).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(api.webhookRedeliver).toHaveBeenCalledWith(5));
  });

  it('shows the reason when an action is refused', async () => {
    await open({
      webhookEnabled: vi.fn(async () => {
        throw new Error('enable the connection first');
      }),
    });
    fireEvent.click(
      within(screen.getByTestId('webhook-w1')).getByRole('button', { name: 'Enable' }),
    );
    expect(await screen.findByText(/enable the connection first/)).toBeTruthy();
  });
});
