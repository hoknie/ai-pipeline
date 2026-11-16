// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';

import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi, openFake, queueOf, settingsOf } from './fixtures.ts';

beforeEach(() => {
  window.location.hash = '#settings/global/queue';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const POOLS = {
  claude: { max: 2, members: ['claude'] },
  b: { max: 1, members: ['opencode:zai/*'] },
};

function show(options: { pools?: object; defaultMax?: number | null; errors?: object[] } = {}) {
  const { pools = {}, defaultMax = null, errors = [] } = options;
  const has = Object.keys(pools).length > 0;
  const api = fakeApi({
    queue: vi.fn(async () => queueOf()),
    config: vi.fn(async () =>
      configView({
        errors: errors as never,
        settings: settingsOf({
          'queue.pools': {
            path: 'queue.pools',
            value: pools,
            ...(has ? { written: { global: pools } } : {}),
          },
          'queue.default_pool.max': {
            path: 'queue.default_pool.max',
            value: defaultMax,
            ...(defaultMax !== null ? { written: { global: defaultMax } } : {}),
          },
        }),
      }),
    ),
  });
  render(<App api={api} openStream={openFake} />);
  return api;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const card = async () => within(await screen.findByTestId('setting-queue.pools'));

/** Opens the selectors of the pool and types a selector; returns the search line. */
async function typeSelector(index: number, text: string) {
  fireEvent.click(screen.getAllByRole('combobox', { name: 'Selectors' })[index]!);
  const input = (await screen.findByRole('combobox', {
    name: 'Search in Selectors',
  })) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
}

describe('queue pools of the settings', () => {
  it('shows the pools of the file with their selectors as chips and the default pool', async () => {
    show({ pools: POOLS, defaultMax: 3 });
    const pools = await card();
    expect(pools.getAllByLabelText('Pool')).toHaveLength(2);
    expect(pools.getByRole('button', { name: 'Remove claude' })).toBeTruthy();
    expect(pools.getByRole('button', { name: 'Remove opencode:zai/*' })).toBeTruthy();
    expect((pools.getByLabelText('Other attempts') as HTMLInputElement).value).toBe('3');
  });

  it('shows an explanation and no «Other attempts» without pools', async () => {
    show();
    const pools = await card();
    expect(pools.getByText(/No pools yet/)).toBeTruthy();
    expect(pools.getByRole('button', { name: 'Add pool' })).toBeTruthy();
    expect(pools.queryByLabelText('Other attempts')).toBeNull();
  });

  it('writes the first pool and the default pool in one request', async () => {
    const api = show();
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Add pool' }));
    fireEvent.change(pools.getByLabelText('Pool'), { target: { value: 'claude' } });
    await typeSelector(0, 'claude');
    expect((pools.getByLabelText('Other attempts') as HTMLInputElement).value).toBe('1');
    save();
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        {
          'queue.pools': { claude: { max: 1, members: ['claude'] } },
          'queue.default_pool.max': 1,
        },
        'g1',
        'global',
      ),
    );
  });

  it('shows a new pool without errors and focuses its name', async () => {
    show();
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Add pool' }));
    const name = pools.getByLabelText('Pool');
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-invalid')).toBe('false');
    expect(pools.queryByRole('alert')).toBeNull();
    expect(pools.getByText(/Which attempts the pool takes/)).toBeTruthy();
  });

  it('shows a problem of a field only after the user leaves it', async () => {
    show();
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Add pool' }));
    const name = pools.getByLabelText('Pool');
    fireEvent.blur(name);
    expect(pools.getByText('The pool needs a name.')).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(pools.queryByText('Add at least one selector.')).toBeNull();
  });

  it('removes any selector with its chip button', async () => {
    const api = show({
      pools: { a: { max: 1, members: ['claude', 'agy', 'opencode'] } },
      defaultMax: 1,
    });
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Remove agy' }));
    expect(pools.queryByRole('button', { name: 'Remove agy' })).toBeNull();
    save();
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        { 'queue.pools': { a: { max: 1, members: ['claude', 'opencode'] } } },
        'g1',
        'global',
      ),
    );
  });

  it('adds a selector on Enter without sending anything', async () => {
    const api = show({ pools: { a: POOLS.claude }, defaultMax: 1 });
    const pools = await card();
    await typeSelector(0, 'opencode:google/*');
    expect(pools.getByRole('button', { name: 'Remove opencode:google/*' })).toBeTruthy();
    expect(api.writeSettings).not.toHaveBeenCalled();
  });

  it('refuses a selector of a wrong format and keeps the text', async () => {
    show({ pools: { a: POOLS.claude }, defaultMax: 1 });
    const pools = await card();
    const input = await typeSelector(0, 'gpt-4');
    expect(input.value).toBe('gpt-4');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Use claude, agy, opencode/);
    expect(pools.queryByRole('button', { name: 'Remove gpt-4' })).toBeNull();
    fireEvent.change(input, { target: { value: 'opencode:google/' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Name a model/);
  });

  it('refuses a selector that overlaps another pool', async () => {
    const api = show({ pools: POOLS, defaultMax: 1 });
    const pools = await card();
    await typeSelector(0, 'opencode:zai/glm-4');
    expect((await screen.findByRole('alert')).textContent).toMatch(/overlaps `opencode:zai\/\*`/);
    expect(pools.queryByRole('button', { name: 'Remove opencode:zai/glm-4' })).toBeNull();
    expect(api.writeSettings).not.toHaveBeenCalled();
  });

  it('marks a wrong selector of the file and does not write it', async () => {
    const api = show({ pools: { a: { max: 1, members: ['gpt-4'] } }, defaultMax: 1 });
    const pools = await card();
    expect(pools.getByText(/Use claude, agy, opencode/)).toBeTruthy();
    fireEvent.change(pools.getByLabelText('At most'), { target: { value: '2' } });
    save();
    await screen.findByText('Fix the pools before saving.');
    expect(api.writeSettings).not.toHaveBeenCalled();
  });

  it('sends null for both fields when the last pool is removed', async () => {
    const api = show({ pools: { claude: POOLS.claude }, defaultMax: 2 });
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Remove pool' }));
    save();
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        { 'queue.pools': null, 'queue.default_pool.max': null },
        'g1',
        'global',
      ),
    );
  });

  it('shows the missing selectors at the field after a failed save, then hides them on discard', async () => {
    const api = show();
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Add pool' }));
    fireEvent.change(pools.getByLabelText('Pool'), { target: { value: 'a' } });
    expect(pools.queryByText('Add at least one selector.')).toBeNull();
    save();
    await screen.findByText('Fix the pools before saving.');
    expect(pools.getByText('Add at least one selector.')).toBeTruthy();
    expect(api.writeSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(pools.queryByLabelText('Pool')).toBeNull());
    fireEvent.click(pools.getByRole('button', { name: 'Add pool' }));
    expect(pools.queryByRole('alert')).toBeNull();
  });

  it('writes the limit and the pools in one save', async () => {
    const api = show({ pools: { claude: POOLS.claude }, defaultMax: 2 });
    const pools = await card();
    fireEvent.change(screen.getByLabelText('Agents at once'), { target: { value: '8' } });
    fireEvent.change(pools.getAllByLabelText('At most')[0] as HTMLElement, {
      target: { value: '4' },
    });
    save();
    await waitFor(() =>
      expect(api.writeSettings).toHaveBeenCalledWith(
        {
          'queue.max': 8,
          'queue.pools': { claude: { max: 4, members: ['claude'] } },
        },
        'g1',
        'global',
      ),
    );
  });

  it('shows the error of the daemon at the selector of the pool', async () => {
    show({
      pools: POOLS,
      defaultMax: 1,
      errors: [
        {
          file: '/xdg/aip/settings.yaml',
          path: 'swarm.queue.pools.b.members[0]',
          message: 'overlaps the pool claude',
        },
      ],
    });
    const pools = await card();
    const message = await pools.findByText('overlaps the pool claude');
    expect(message.closest('[data-testid="pool-b"]')).not.toBeNull();
  });

  it('shows a rejected save once, inside the pool', async () => {
    const api = show({ pools: POOLS, defaultMax: 1 });
    vi.mocked(api.writeSettings).mockResolvedValue({
      ok: false,
      reason: 'invalid',
      errors: [{ file: 'f', path: 'swarm.queue.pools.b.members[0]', message: 'overlaps claude' }],
    } as never);
    const pools = await card();
    fireEvent.change(pools.getAllByLabelText('At most')[0] as HTMLElement, {
      target: { value: '3' },
    });
    save();
    const messages = await pools.findAllByText('overlaps claude');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.closest('[data-testid="pool-b"]')).not.toBeNull();
  });

  it('shows the error of the default pool next to «Other attempts»', async () => {
    show({
      pools: POOLS,
      defaultMax: 1,
      errors: [{ file: 'f', path: 'swarm.queue.default_pool', message: 'is required' }],
    });
    const pools = await card();
    const message = await pools.findByText('is required');
    expect(
      message.parentElement?.querySelector('#field-queue\\.default_pool\\.max'),
    ).not.toBeNull();
    expect(pools.getAllByText(/is required/)).toHaveLength(1);
  });

  it('undoes the changes of the pools', async () => {
    show({ pools: { claude: POOLS.claude }, defaultMax: 2 });
    const pools = await card();
    fireEvent.click(pools.getByRole('button', { name: 'Add pool' }));
    expect(pools.getAllByLabelText('Pool')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(pools.getAllByLabelText('Pool')).toHaveLength(1));
  });

  it('has no pools card on the project tab', async () => {
    window.location.hash = '#settings/project/queue';
    show();
    await screen.findByRole('region', { name: 'queue settings' });
    expect(screen.queryByTestId('setting-queue.pools')).toBeNull();
  });
});
