// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsGroup } from '../src/features/integrations/index.ts';
import { paramsChange } from '../src/features/integrations/connections/ParamField.tsx';
import { ApiError } from '../src/shared/api/api.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';
import type { IntegrationTab } from '../src/shared/lib/nav/settingsGroups.ts';

import {
  deliveryView,
  fakeApi,
  integrationsOverview,
  projectLinkView,
  repositoryView,
} from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

afterEach(() => cleanup());

const registry = [repositoryView('/work/app', { color: 'blue' })];

const leave = () => async () => undefined;

function mount(api: ReturnType<typeof fakeApi>, tab: IntegrationTab) {
  return render(<IntegrationsGroup api={api} registry={registry} tab={tab} leave={leave} />);
}

async function open(
  overrides: Parameters<typeof fakeApi>[0] = {},
  tab: IntegrationTab = 'connections',
) {
  const api = fakeApi(overrides);
  mount(api, tab);
  await screen.findByTestId(tab === 'notifications' ? 'subscription-n1' : 'connection-c1');
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
    expect(within(card).getByLabelText(/^Chat/)).toBeTruthy();
    expect(within(card).getByLabelText(/^Who may answer/)).toBeTruthy();
    expect(within(card).queryByLabelText(/bot_token/)).toBeNull();
    expect(card.querySelector('input[type="password"]')).toBeNull();
    expect(within(card).queryByDisplayValue(/\d{5,}:/)).toBeNull();
  });

  it('shows the labels in Russian with the technical names under them and the language choice', async () => {
    await i18next.changeLanguage('ru');
    try {
      const api = await open();
      const card = screen.getByTestId('connection-c1');
      const field = within(card).getByLabelText(/^Кто может отвечать/);
      expect(within(card).getByText('allowed_users').tagName).toBe('CODE');
      expect(field.getAttribute('aria-describedby')).not.toBeNull();
      const chat = within(card).getByLabelText(/^Чат/);
      const hint = document.getElementById(chat.getAttribute('aria-describedby') ?? '');
      expect(hint?.textContent).toContain('/id');
      expect(within(card).getByText('Токен бота')).toBeTruthy();
      const select = within(card).getByLabelText(/^Язык сообщений бота/) as HTMLSelectElement;
      expect(Array.from(select.options).map((one) => one.textContent)).toEqual([
        'По умолчанию (English)',
        'English',
        'Русский',
      ]);
      fireEvent.change(select, { target: { value: 'ru' } });
      fireEvent.click(within(card).getByRole('button', { name: 'Сохранить параметры' }));
      await waitFor(() =>
        expect(api.integrationEdit).toHaveBeenCalledWith('c1', {
          set: { language: 'ru' },
          unset: [],
        }),
      );
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('labels the secret slot of a Slack card and keeps the technical name and command', async () => {
    const overview = integrationsOverview();
    overview.connections[0] = {
      ...overview.connections[0]!,
      kind: 'slack',
      secrets: [
        { slot: 'bot_token', required: true, present: true },
        { slot: 'app_token', required: true, present: false },
      ],
    };
    overview.types = [{ ...overview.types[0]!, kind: 'slack', title: 'Slack app' }];
    await open({ integrations: vi.fn(async () => overview) });
    const card = screen.getByTestId('connection-c1');
    expect(within(card).getByText('App token (Socket Mode)')).toBeTruthy();
    expect(within(card).getAllByText('app_token')[0]!.tagName).toBe('CODE');
    expect(within(card).getByText('aip integration secret set c1 app_token --stdin')).toBeTruthy();
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
    fireEvent.change(within(card).getByLabelText(/^Chat/), { target: { value: '-1001' } });
    fireEvent.change(within(card).getByLabelText(/^Bot message language/), {
      target: { value: 'ru' },
    });
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
    fireEvent.change(within(card).getByLabelText(/^Who may answer/), { target: { value: 'x' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save parameters' }));
    expect(await screen.findByText(/allowed_users: not a list of ids/)).toBeTruthy();
    expect(api.integrationEdit).toHaveBeenCalledTimes(1);
  });

  it('creates a subscription for all projects with the events chosen', async () => {
    const api = await open({}, 'notifications');
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
    const api = await open({}, 'notifications');
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
    const api = await open({}, 'notifications');
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
    const api = await open({}, 'notifications');
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
    await open({ deliveries }, 'notifications');
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
    mount(empty, 'connections');
    expect(await screen.findByText(/No connections yet/)).toBeTruthy();
    expect(screen.getByRole('form', { name: 'New connection' })).toBeTruthy();
    cleanup();
    const broken = fakeApi({
      integrations: vi.fn(async () => {
        throw new ApiError(500, 'daemon is down');
      }),
    });
    mount(broken, 'connections');
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

describe('the address of the group', () => {
  it('moves the old #integrations into the shared settings', () => {
    expect(parseRoute('#integrations')).toMatchObject({
      view: 'settings',
      run: 'integrations',
      group: 'global',
    });
    expect(formatRoute(parseRoute('#integrations'))).toBe('#settings/global/integrations');
  });

  it('puts the tab in the third part, and leaves it out for the first tab', () => {
    expect(formatRoute(parseRoute('#settings/global/integrations/webhooks'))).toBe(
      '#settings/global/integrations/webhooks',
    );
    expect(formatRoute(parseRoute('#settings/global/integrations/registry'))).toBe(
      '#settings/global/integrations/registry',
    );
    expect(formatRoute(parseRoute('#settings/global/integrations/connections'))).toBe(
      '#settings/global/integrations',
    );
    expect(formatRoute(parseRoute('#settings/global/integrations/nope'))).toBe(
      '#settings/global/integrations',
    );
  });

  it('has no project tab: that address leads to the shared one', () => {
    expect(formatRoute(parseRoute('#settings/project/integrations/webhooks'))).toBe(
      '#settings/global/integrations/webhooks',
    );
  });
});

describe('the tabs of the group', () => {
  it('are addresses, and the open one is selected', async () => {
    await open({}, 'connections');
    const tabs = within(screen.getByRole('tablist', { name: 'Integrations tabs' })).getAllByRole(
      'tab',
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Connections',
      'Service registry',
      'Notifications',
      'Webhooks',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '#settings/global/integrations',
      '#settings/global/integrations/registry',
      '#settings/global/integrations/notifications',
      '#settings/global/integrations/webhooks',
    ]);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('a new connection', () => {
  it('is made from the form with its kind parameters, and offers neither a webhook nor a secret', async () => {
    const overview = integrationsOverview();
    overview.types.push({
      kind: 'webhook',
      title: 'Outgoing webhook',
      params: [{ name: 'url', required: true, maxLength: 2048 }],
      secrets: [],
      directions: ['outbound'],
      operations: [],
      createdBy: 'aip webhook add',
    });
    const api = await open({ integrations: vi.fn(async () => overview) });
    const form = screen.getByRole('form', { name: 'New connection' });
    expect(within(form).queryByRole('option', { name: 'Outgoing webhook' })).toBeNull();
    expect(form.querySelector('input[type="password"]')).toBeNull();
    expect(within(form).queryByLabelText(/bot_token/)).toBeNull();
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'main' } });
    fireEvent.change(within(form).getByLabelText(/^Who may answer/), { target: { value: '111' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create connection' }));
    await waitFor(() =>
      expect(api.integrationAdd).toHaveBeenCalledWith({
        kind: 'telegram',
        name: 'main',
        params: { allowed_users: '111' },
      }),
    );
  });

  it('can be made for one project', async () => {
    const api = await open();
    const form = screen.getByRole('form', { name: 'New connection' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'team' } });
    fireEvent.change(within(form).getByLabelText('Where'), { target: { value: '/work/app' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create connection' }));
    await waitFor(() =>
      expect(api.integrationAdd).toHaveBeenCalledWith({
        kind: 'telegram',
        name: 'team',
        repository: '/work/app',
      }),
    );
  });

  it('shows the refusal and keeps what was typed', async () => {
    await open({
      integrationAdd: vi.fn(async () => {
        throw new ApiError(400, 'allowed_users: not a list of ids');
      }),
    });
    const form = screen.getByRole('form', { name: 'New connection' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'main' } });
    fireEvent.change(within(form).getByLabelText(/^Who may answer/), { target: { value: 'x' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create connection' }));
    expect(await screen.findByText(/allowed_users: not a list of ids/)).toBeTruthy();
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('main');
    expect((within(form).getByLabelText(/^Who may answer/) as HTMLInputElement).value).toBe('x');
  });
});

describe('the actions of a connection', () => {
  it('enables and disables it, and shows the refusal when the secret is missing', async () => {
    const api = await open({
      integrationEnabled: vi.fn(async () => {
        throw new ApiError(400, 'the secret bot_token is not set');
      }),
    });
    const card = screen.getByTestId('connection-c1');
    fireEvent.click(within(card).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(api.integrationEnabled).toHaveBeenCalledWith('c1', true));
    expect(await screen.findByText(/the secret bot_token is not set/)).toBeTruthy();
  });

  it('switches an enabled connection off', async () => {
    const overview = integrationsOverview();
    overview.connections[0]!.enabled = true;
    const api = await open({ integrations: vi.fn(async () => overview) });
    fireEvent.click(
      within(screen.getByTestId('connection-c1')).getByRole('button', { name: 'Disable' }),
    );
    await waitFor(() => expect(api.integrationEnabled).toHaveBeenCalledWith('c1', false));
  });

  it('removes it only after the confirmation', async () => {
    const api = await open();
    const card = screen.getByTestId('connection-c1');
    fireEvent.click(within(card).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.integrationRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.integrationRemove).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => expect(api.integrationRemove).toHaveBeenCalledWith('c1'));
  });

  it('copies the command that sets the secret', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    fireEvent.click(
      within(screen.getByTestId('connection-c1')).getByRole('button', { name: 'Copy command' }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('aip integration secret set c1 bot_token --stdin'),
    );
  });

  it('does not list webhooks or registries among the connections', async () => {
    const overview = integrationsOverview();
    for (const kind of ['webhook', 'service-registry']) {
      overview.connections.push({ ...overview.connections[0]!, id: kind, kind, name: kind });
    }
    await open({ integrations: vi.fn(async () => overview) });
    expect(screen.queryByTestId('connection-webhook')).toBeNull();
    expect(screen.queryByTestId('connection-service-registry')).toBeNull();
  });
});

describe('the tab «Service registry»', () => {
  const svcr = (patch: Record<string, unknown> = {}) => {
    const overview = integrationsOverview();
    overview.types.push({
      kind: 'service-registry',
      title: 'Service registry',
      params: [{ name: 'url', required: true, maxLength: 2048 }],
      secrets: [{ slot: 'token', required: true }],
      directions: ['outbound'],
      operations: [],
    });
    overview.connections.push({
      ...overview.connections[0]!,
      id: 'r1',
      kind: 'service-registry',
      name: 'svcr',
      params: { url: 'https://registry.example.com' },
      enabled: true,
      secrets: [{ slot: 'token', required: true, present: true }],
      ...patch,
    });
    return overview;
  };
  const openRegistry = async (
    overview: ReturnType<typeof svcr>,
    overrides: Parameters<typeof fakeApi>[0] = {},
  ) => {
    const api = fakeApi({ integrations: vi.fn(async () => overview), ...overrides });
    mount(api, 'registry');
    await screen.findByTestId('connection-r1');
    return api;
  };

  it('makes a registry connection with the url, and the form has the kind fixed', async () => {
    const overview = svcr();
    const api = await openRegistry(overview);
    const form = screen.getByRole('form', { name: 'New connection' });
    expect(within(form).queryByLabelText('Kind')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'second' } });
    fireEvent.change(within(form).getByLabelText(/^Address/), {
      target: { value: 'https://other.example.com' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Create connection' }));
    await waitFor(() =>
      expect(api.integrationAdd).toHaveBeenCalledWith({
        kind: 'service-registry',
        name: 'second',
        params: { url: 'https://other.example.com' },
      }),
    );
  });

  it('shows the url and the token status, and says the check was never run', async () => {
    await openRegistry(svcr());
    const card = screen.getByTestId('connection-r1');
    expect((within(card).getByLabelText(/^Address/) as HTMLInputElement).value).toBe(
      'https://registry.example.com',
    );
    expect(within(card).getByText('set')).toBeTruthy();
    expect(within(card).getByText('Not checked yet')).toBeTruthy();
  });

  it('checks the connection and shows the number of tools, locking the button meanwhile', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const api = await openRegistry(svcr(), {
      integrationCheck: vi.fn(() => new Promise((resolve) => (finish = resolve))) as never,
    });
    const card = screen.getByTestId('connection-r1');
    fireEvent.click(within(card).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(api.integrationCheck).toHaveBeenCalledWith('r1'));
    expect(
      (within(card).getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    finish(undefined);
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Check' })).toBeTruthy());
  });

  it('shows ok with the count, or the code of a failure, from the last check', async () => {
    await openRegistry(svcr({ lastCheck: { at: 1, ok: true, code: null, count: 14 } }));
    expect(within(screen.getByTestId('connection-r1')).getByText('ok, 14 tools')).toBeTruthy();
    cleanup();
    await openRegistry(
      svcr({ lastCheck: { at: 1, ok: false, code: 'unauthorized', count: null } }),
    );
    expect(
      within(screen.getByTestId('connection-r1')).getByText(
        'Registry rejected the token (unauthorized)',
      ),
    ).toBeTruthy();
  });

  it('shows the text of a code in the language of the panel and an unknown code as it is', async () => {
    await i18next.changeLanguage('ru');
    try {
      await openRegistry(
        svcr({ lastCheck: { at: 1, ok: false, code: 'unauthorized', count: null } }),
      );
      expect(
        within(screen.getByTestId('connection-r1')).getByText(
          'Registry отклонил токен (unauthorized)',
        ),
      ).toBeTruthy();
      cleanup();
      await openRegistry(svcr({ lastCheck: { at: 1, ok: false, code: 'weird', count: null } }));
      expect(within(screen.getByTestId('connection-r1')).getByText('ошибка: weird')).toBeTruthy();
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('shows the refusal of a check without a token or with a wrong url', async () => {
    for (const message of ['the secret token is not set', 'url: not an address']) {
      await openRegistry(svcr(), {
        integrationCheck: vi.fn(async () => {
          throw new ApiError(400, message);
        }),
      });
      fireEvent.click(
        within(screen.getByTestId('connection-r1')).getByRole('button', { name: 'Check' }),
      );
      expect(await screen.findByText(new RegExp(message))).toBeTruthy();
      cleanup();
    }
  });

  it('lists the links of the projects with the way they were made, and leads to the project group', async () => {
    await openRegistry(svcr(), {
      integrationLinks: vi.fn(async () => [projectLinkView('r1', '/work/app')]),
    });
    const table = await screen.findByTestId('registry-links');
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('by origin')).toBeTruthy();
    expect(within(row).getByText('Linked')).toBeTruthy();
    const link = within(row).getAllByRole('link')[0]!;
    expect(link.getAttribute('href')).toMatch(/^#settings\/global\/projects\//);
    expect(within(row).getByRole('link', { name: 'acme/backend/api' }).getAttribute('href')).toBe(
      'https://registry.example.com/catalog?node=acme%2Fbackend%2Fapi',
    );
  });

  it('says so when the registry has no connection', async () => {
    mount(fakeApi(), 'registry');
    expect(await screen.findByText(/No service registry connections yet/)).toBeTruthy();
  });
});
