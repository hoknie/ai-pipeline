// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPage } from '../src/features/providers/index.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi } from './fixtures.ts';
import {
  accessState,
  editorProvider,
  providerModelsView,
  providersView,
  providerView,
  roleView,
} from './providerFixtures.ts';
import { chooseModel } from './modelField.ts';

afterEach(cleanup);

let counter = 0;

function mount(options: {
  providers: ReturnType<typeof providerView>[];
  files?: Record<string, Record<string, unknown>>;
  overrides?: Parameters<typeof fakeApi>[0];
  /** The level of the file of each provider; the project scope writes only «project». */
  levels?: Record<string, 'global' | 'project'>;
  roles?: ReturnType<typeof roleView>[];
}) {
  counter += 1;
  const roles = options.roles ?? [roleView('think', 'Think'), roleView('code', 'Code')];
  const view = providersView({ roles, providers: options.providers });
  const files = options.files ?? {};
  const api = fakeApi({
    providers: vi.fn(async () => view),
    config: vi.fn(async () =>
      configView({
        providers: options.providers.map((provider) =>
          editorProvider(
            provider.slug,
            files[provider.slug] ?? { name: provider.name },
            options.levels?.[provider.slug] ?? 'project',
          ),
        ),
      }),
    ),
    ...options.overrides,
  });
  render(
    <ProvidersPage
      api={api}
      repository={`/matrix-${counter}`}
      runs={[]}
      selected={null}
      section={null}
      preset={null}
      project={null}
      onSelect={vi.fn()}
    />,
  );
  return api;
}

const claude = providerView('anthropic', {
  name: 'Anthropic',
  models: { think: { model: 'opus' } } as never,
});
const off = providerView('old', { name: 'Old', enabled: false, status: 'disabled' });

describe('the matrix role × provider', () => {
  it('has a row per role and a column per enabled provider', async () => {
    mount({ providers: [claude, off] });
    const matrix = await screen.findByRole('region', { name: 'Role × provider matrix' });
    expect(within(matrix).getByText('Think')).toBeTruthy();
    expect(within(matrix).getByText('Code')).toBeTruthy();
    expect(within(matrix).queryByText('Old')).toBeNull();
    fireEvent.click(within(matrix).getByRole('switch', { name: 'Show disabled' }));
    expect(within(matrix).getByText('Old')).toBeTruthy();
  });

  it('shows the models of a shared provider as text and writes nothing to it', async () => {
    const api = mount({
      providers: [claude, providerView('zai', { name: 'Z.ai' })],
      levels: { anthropic: 'global' },
    });
    const matrix = await screen.findByRole('region', { name: 'Role × provider matrix' });
    await screen.findByRole('combobox', { name: 'Code × Z.ai' });
    // the shared column has no combobox and no options button; the project one is editable
    expect(within(matrix).queryByRole('combobox', { name: 'Think × Anthropic' })).toBeNull();
    expect(within(matrix).getByLabelText('Think × Anthropic').textContent).toBe('opus');
    await chooseModel('glm-5.3', 'Code × Z.ai');
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    for (const call of vi.mocked(api.writeProvider).mock.calls) expect(call[3]).toBe('project');
  });

  it('marks empty cells and shows the model of the filled ones', async () => {
    mount({ providers: [claude] });
    const filled = await screen.findByRole('combobox', { name: 'Think × Anthropic' });
    expect(filled.textContent).toContain('opus');
    const empty = screen.getByRole('combobox', { name: 'Code × Anthropic' });
    expect(empty.closest('[data-empty="true"]')).not.toBeNull();
  });

  it('marks an access with a model of its own', async () => {
    const provider = providerView('zai', {
      name: 'Z.ai',
      access: [
        {
          ...accessState({ runtime: 'claude' }),
          models: { code: { model: 'glm-5.3' } } as never,
        },
      ],
    });
    mount({ providers: [provider] });
    const mark = await screen.findByRole('img', { name: /claude: glm-5\.3/ });
    expect(mark.getAttribute('title')).toContain('claude: glm-5.3');
  });

  it('does not mark an inherited constructor as an access override', async () => {
    mount({
      roles: [roleView('constructor', 'Constructor')],
      providers: [
        providerView('example', {
          name: 'Example',
          models: { constructor: { model: 'A' } },
          access: [{ ...accessState({ runtime: 'claude' }), models: {} }],
        }),
      ],
    });
    const cell = await screen.findByRole('combobox', { name: 'Constructor × Example' });
    expect(cell.textContent).toContain('A');
    const matrix = screen.getByRole('region', { name: 'Role × provider matrix' });
    expect(within(matrix).queryByRole('img')).toBeNull();
    expect(matrix.textContent).not.toContain('undefined');
  });

  it('writes a typed model of a cell into the file with its revision', async () => {
    const api = mount({
      providers: [providerView('zai', { name: 'Z.ai' })],
      files: { zai: { name: 'Z.ai' } },
      overrides: {
        providerModels: vi.fn(async (provider: string) =>
          providerModelsView(provider, [{ manual: true }]),
        ),
      },
    });
    await screen.findByRole('combobox', { name: 'Code × Z.ai' });
    await chooseModel('glm-5.3', 'Code × Z.ai');
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    expect(api.writeProvider).toHaveBeenCalledWith(
      'zai',
      { name: 'Z.ai', models: { code: 'glm-5.3' } },
      'zai-r1',
      'project',
    );
  });

  it('shows the hint to type the ID when the catalog has no list', async () => {
    mount({
      providers: [providerView('zai', { name: 'Z.ai' })],
      overrides: {
        providerModels: vi.fn(async (provider: string) =>
          providerModelsView(provider, [{ manual: true }]),
        ),
      },
    });
    fireEvent.click(await screen.findByRole('combobox', { name: 'Code × Z.ai' }));
    expect(
      await screen.findByText('The list of models is not available — type the ID'),
    ).toBeTruthy();
  });

  it('shows options of a model only for opencode', async () => {
    const api = mount({
      providers: [
        providerView('zai', {
          name: 'Z.ai',
          access: [{ ...accessState({ runtime: 'opencode' }), models: {} }],
          models: { code: { model: 'zai/glm' } } as never,
        }),
        providerView('anthropic', { name: 'Anthropic' }),
      ],
      files: { zai: { name: 'Z.ai', models: { code: 'zai/glm' } } },
    });
    await screen.findByRole('combobox', { name: 'Code × Z.ai' });
    expect(screen.getAllByRole('button', { name: /Model options/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Model options: Code × Z.ai' }));
    fireEvent.change(await screen.findByLabelText('Variant'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    expect(vi.mocked(api.writeProvider).mock.calls[0]?.[1]).toEqual({
      name: 'Z.ai',
      models: { code: { model: 'zai/glm', variant: 'high' } },
    });
  });

  it('shows the error of a failed write at its cell', async () => {
    const api = mount({
      providers: [providerView('zai', { name: 'Z.ai' })],
      overrides: {
        writeProvider: vi.fn(async () => ({
          ok: false as const,
          reason: 'conflict' as const,
          message: 'The file changed meanwhile',
        })),
        providerModels: vi.fn(async (provider: string) =>
          providerModelsView(provider, [{ manual: true }]),
        ),
      },
    });
    await screen.findByRole('combobox', { name: 'Code × Z.ai' });
    await chooseModel('glm', 'Code × Z.ai');
    expect((await screen.findByRole('alert')).textContent).toContain('The file changed meanwhile');
    expect(api.writeProvider).toHaveBeenCalledTimes(1);
    // the matrix is read again, so the cell shows what the file holds
    await waitFor(() => expect(vi.mocked(api.providers).mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(vi.mocked(api.config).mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps j and k for the search of a model typed in a cell', async () => {
    mount({
      providers: [
        providerView('zai', { name: 'Z.ai' }),
        providerView('openai', { name: 'OpenAI' }),
      ],
      overrides: {
        providerModels: vi.fn(async (provider: string) =>
          providerModelsView(provider, [{ manual: true }]),
        ),
      },
    });
    await screen.findByRole('combobox', { name: 'Code × Z.ai' });
    fireEvent.keyDown(window, { key: 'j' });
    const rows = () => screen.getAllByRole('button', { name: /^(Z\.ai|OpenAI)/ });
    const current = () => rows().map((row) => row.getAttribute('aria-current'));
    const before = current();
    expect(before).toContain('true');
    fireEvent.click(screen.getByRole('combobox', { name: 'Code × Z.ai' }));
    const search = await screen.findByRole<HTMLInputElement>('combobox', {
      name: 'Search in Code × Z.ai',
    });
    search.focus();
    fireEvent.change(search, { target: { value: 'jk' } });
    fireEvent.keyDown(search, { key: 'j' });
    fireEvent.keyDown(search, { key: 'k' });
    expect(search.value).toBe('jk');
    expect(current()).toEqual(before);
  });
});
