// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import IntegrationsPage from '../src/features/integrations/IntegrationsPage.tsx';
import { paramsChange } from '../src/features/integrations/ConnectionCard.tsx';
import { ApiError } from '../src/shared/api/api.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';

import { deliveryView, fakeApi, integrationsOverview, repositoryView } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

afterEach(() => cleanup());

const registry = [repositoryView('/work/app', { color: 'blue' })];

async function open(overrides: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(overrides);
  render(<IntegrationsPage api={api} registry={registry} />);
  await screen.findByTestId('connection-c1');
  return api;
}

describe('the page of integrations', () => {
  it('shows the connection, its missing secret and the command that sets it, and takes no secret', async () => {
    await open();
    const card = screen.getByTestId('connection-c1');
    expect(within(card).getByText('main')).toBeTruthy();
    expect(within(card).getByText('not set')).toBeTruthy();
    expect(within(card).getByText('aip integration secret set c1 bot_token --stdin')).toBeTruthy();
    // the fields are the non-secret parameters of the kind, and none is for the token
    expect(within(card).getByLabelText(/^chat_id/)).toBeTruthy();
    expect(within(card).getByLabelText(/^allowed_users/)).toBeTruthy();
    expect(within(card).queryByLabelText(/bot_token/)).toBeNull();
    expect(card.querySelector('input[type="password"]')).toBeNull();
    expect(within(card).queryByDisplayValue(/\d{5,}:/)).toBeNull();
  });

  it('does not show the command for a secret that is set, and shows the channel error', async () => {
    const overview = integrationsOverview();
    overview.connections[0]!.secrets[0]!.present = true;
    overview.connections[0]!.enabled = true;
    overview.channels = [
      {
        connection: 'c1',
        state: 'error',
        error: 'telegram answered 409: delete the webhook of the bot',
        unauthorized: false,
      },
    ];
    await open({ integrations: vi.fn(async () => overview) });
    const card = screen.getByTestId('connection-c1');
    expect(within(card).queryByText(/aip integration secret set/)).toBeNull();
    expect(within(card).getAllByText(/delete the webhook/).length).toBeGreaterThan(0);
  });

  it('saves a changed parameter and removes an optional one that was cleared', async () => {
    const api = await open();
    const card = screen.getByTestId('connection-c1');
    const save = within(card).getByRole('button', { name: 'Save parameters' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText(/^chat_id/), { target: { value: '-1001' } });
    fireEvent.change(within(card).getByLabelText(/^language/), { target: { value: 'ru' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.integrationEdit).toHaveBeenCalledWith('c1', {
        set: { chat_id: '-1001', language: 'ru' },
        unset: [],
      }),
    );
  });

  it('shows the reason when an edit is refused', async () => {
    const api = await open({
      integrationEdit: vi.fn(async () => {
        throw new ApiError(400, 'allowed_users: not a list of ids');
      }),
    });
    const card = screen.getByTestId('connection-c1');
    fireEvent.change(within(card).getByLabelText(/^allowed_users/), { target: { value: 'x' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save parameters' }));
    expect(await screen.findByText(/allowed_users: not a list of ids/)).toBeTruthy();
    expect(api.integrationEdit).toHaveBeenCalledTimes(1);
  });

  it('creates a subscription for all projects with the events chosen', async () => {
    const api = await open();
    const form = screen.getByRole('form', { name: 'New subscription' });
    fireEvent.click(within(form).getByLabelText('Group failed'));
    fireEvent.click(within(form).getByRole('button', { name: 'Subscribe' }));
    await waitFor(() =>
      expect(api.subscriptionAdd).toHaveBeenCalledWith({
        connection: 'c1',
        events: ['question', 'failed'],
      }),
    );
  });

  it('creates a subscription for one project', async () => {
    const api = await open();
    const form = screen.getByRole('form', { name: 'New subscription' });
    fireEvent.change(within(form).getByLabelText('Project'), { target: { value: '/work/app' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Subscribe' }));
    await waitFor(() =>
      expect(api.subscriptionAdd).toHaveBeenCalledWith({
        connection: 'c1',
        repository: '/work/app',
        events: ['question'],
      }),
    );
  });

  it('changes, switches, tests and removes a subscription', async () => {
    const api = await open();
    const row = screen.getByTestId('subscription-n1');
    fireEvent.click(within(row).getByLabelText('Task finished'));
    await waitFor(() =>
      expect(api.subscriptionEvents).toHaveBeenCalledWith('n1', ['question', 'finished']),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(api.subscriptionEnabled).toHaveBeenCalledWith('n1', false));
    fireEvent.click(within(row).getByRole('button', { name: 'Send a test' }));
    await waitFor(() => expect(api.subscriptionTest).toHaveBeenCalledWith('n1'));
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.subscriptionRemove).toHaveBeenCalledWith('n1'));
  });

  it('keeps at least one event on a subscription', async () => {
    const api = await open();
    const row = screen.getByTestId('subscription-n1');
    fireEvent.click(within(row).getByLabelText('Question'));
    await Promise.resolve();
    expect(api.subscriptionEvents).not.toHaveBeenCalled();
  });

  it('filters the journal by state and shows the safe error of a failed delivery', async () => {
    const failed = deliveryView({ id: 2, state: 'failed', attempts: 3, error: 'unauthorized' });
    const deliveries = vi.fn(async (query?: { state?: string }) =>
      query?.state === 'failed' ? [failed] : [deliveryView(), failed],
    );
    await open({ deliveries });
    await screen.findByTestId('journal');
    expect(within(screen.getByTestId('journal')).getAllByRole('row')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'failed' } });
    await waitFor(() =>
      expect(deliveries).toHaveBeenLastCalledWith({ limit: 50, state: 'failed' }),
    );
    await waitFor(() =>
      expect(within(screen.getByTestId('journal')).getAllByRole('row')).toHaveLength(2),
    );
    expect(within(screen.getByTestId('journal')).getByText('unauthorized')).toBeTruthy();
  });

  it('says how to create the first connection, and what went wrong with loading', async () => {
    const empty = fakeApi({
      integrations: vi.fn(async () => integrationsOverview({ connections: [], subscriptions: [] })),
    });
    render(<IntegrationsPage api={empty} registry={registry} />);
    expect(await screen.findByText(/aip integration add telegram/)).toBeTruthy();
    cleanup();
    const broken = fakeApi({
      integrations: vi.fn(async () => {
        throw new ApiError(500, 'daemon is down');
      }),
    });
    render(<IntegrationsPage api={broken} registry={registry} />);
    expect(await screen.findByText(/daemon is down/)).toBeTruthy();
  });
});

describe('paramsChange', () => {
  const params = integrationsOverview().types[0]!.params;

  it('sets what changed, removes an optional parameter that was cleared, keeps a required one', () => {
    expect(
      paramsChange(
        params,
        { allowed_users: '1', chat_id: '5' },
        { chat_id: '', allowed_users: '' },
      ),
    ).toEqual({ set: {}, unset: ['chat_id'] });
    expect(
      paramsChange(params, { allowed_users: '1' }, { chat_id: ' -9 ', allowed_users: '1' }),
    ).toEqual({ set: { chat_id: '-9' }, unset: [] });
    expect(paramsChange(params, { allowed_users: '1' }, {})).toEqual({ set: {}, unset: [] });
  });
});

describe('the address of the page', () => {
  it('is #integrations', () => {
    expect(parseRoute('#integrations').view).toBe('integrations');
    expect(formatRoute(parseRoute('#integrations'))).toBe('#integrations');
  });
});
