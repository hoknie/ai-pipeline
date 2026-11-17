// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { modelValues } from './modelField.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorChain } from '../src/shared/api/types.ts';
import {
  defaultChainDraft,
  draftOfChain,
  sameChainDraft,
  valueOfChain,
} from '../src/features/specialists/chains/draft.ts';
import { ChainForm } from '../src/features/specialists/chains/ChainForm.tsx';
import { ChainsList } from '../src/features/specialists/chains/ChainsList.tsx';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import { SharedChainsGroup } from '../src/features/settings/SharedChainsGroup.tsx';
import { configView, fakeApi } from './fixtures.ts';
import { providersView, providerView } from './providerFixtures.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chainRaw = {
  name: 'Fast then Strong',
  mode: 'on_error',
  enabled: true,
  runtimes: [
    { runtime: 'claude', model: 'haiku', enabled: true },
    { runtime: 'opencode', model: 'gpt-4o', enabled: true },
  ],
};

const chainFixture: EditorChain = {
  slug: 'fast-to-strong',
  level: 'project',
  file: '/repo/aip/chains/fast-to-strong.yaml',
  revision: 'c1',
  raw: chainRaw,
  sources: {
    project: {
      file: '/repo/aip/chains/fast-to-strong.yaml',
      revision: 'c1',
      raw: chainRaw,
    },
  },
};

const sharedChain: EditorChain = {
  ...chainFixture,
  level: 'global',
  file: '/xdg/aip/chains/fast-to-strong.yaml',
  revision: null,
  sources: {
    global: {
      file: '/xdg/aip/chains/fast-to-strong.yaml',
      revision: 'g1',
      raw: chainFixture.raw,
    },
  },
};

describe('chain draft logic', () => {
  it('converts EditorChain to ChainDraft and back', () => {
    const draft = draftOfChain(chainFixture);
    expect(draft.slug).toBe('fast-to-strong');
    expect(draft.name).toBe('Fast then Strong');
    expect(draft.mode).toBe('on_error');
    expect(draft.runtimes).toHaveLength(2);
    expect(draft.runtimes[0]).toEqual({
      runtime: 'claude',
      model: 'haiku',
      variant: '',
      reasoning_effort: '',
      enabled: true,
      provider: '',
      default: false,
    });

    const value = valueOfChain(draft, chainFixture.raw);
    expect(value).toEqual({
      name: 'Fast then Strong',
      mode: 'on_error',
      enabled: true,
      runtimes: [
        { runtime: 'claude', model: 'haiku', enabled: true },
        { runtime: 'opencode', model: 'gpt-4o', enabled: true },
      ],
    });
  });

  it('detects changes with sameChainDraft', () => {
    const d1 = defaultChainDraft('test');
    const d2 = defaultChainDraft('test');
    expect(sameChainDraft(d1, d2)).toBe(true);
    const d3 = { ...d1, name: 'Changed' };
    expect(sameChainDraft(d1, d3)).toBe(false);
  });
});

describe('ChainsList UI', () => {
  it('renders chains with mode and runtime count', () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    render(
      <ChainsList
        chains={[chainFixture]}
        loaded={true}
        selected={null}
        onNew={onNew}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Fast then Strong')).toBeTruthy();
    expect(screen.getByText(/fast-to-strong/)).toBeTruthy();
    fireEvent.click(screen.getByText('Fast then Strong'));
    expect(onSelect).toHaveBeenCalledWith('fast-to-strong');
  });
});

describe('ChainForm UI', () => {
  it('keeps each full model ID with its runtime when rows are reordered and saved', async () => {
    const full = {
      name: 'Qualified models',
      mode: 'on_error',
      enabled: true,
      runtimes: [
        { runtime: 'opencode', model: 'openai/gpt-custom', enabled: true },
        { runtime: 'opencode', model: 'OtherProvider/team/GPT-Custom', enabled: true },
      ],
    };
    const chain = {
      ...chainFixture,
      raw: full,
      sources: {
        ...chainFixture.sources,
        project: { ...chainFixture.sources.project!, raw: full },
      },
    };
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'c2',
      file: '/f',
    }));
    render(
      <ChainForm
        api={fakeApi({ writeChain })}
        chain={chain}
        onDirty={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
      />,
    );
    expect(modelValues().filter((value) => value === 'openai/gpt-custom')).toHaveLength(1);
    expect(modelValues().filter((value) => value === 'OtherProvider/team/GPT-Custom')).toHaveLength(
      1,
    );
    const moveUp = screen.getAllByRole('button', { name: 'Move up' });
    fireEvent.click(moveUp[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as typeof full;
    expect(saved.runtimes.map((item) => item.model)).toEqual([
      'OtherProvider/team/GPT-Custom',
      'openai/gpt-custom',
    ]);
  });

  it('allows saving an existing project chain without changing its fields', async () => {
    const api = fakeApi();
    render(
      <ChainForm
        api={api}
        chain={chainFixture}
        onDirty={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        chainFixture.raw,
        'c1',
        'project',
      ),
    );
  });

  it('renders chain details and saves edits', async () => {
    const onSaved = vi.fn(async () => undefined);
    const onDeleted = vi.fn(async () => undefined);
    const onDirty = vi.fn();
    const writeChain = vi.fn(async () => ({ ok: true as const, revision: 'c2', file: '/f' }));
    const api = fakeApi({ writeChain });

    render(
      <ChainForm
        api={api}
        chain={chainFixture}
        onDirty={onDirty}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />,
    );

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Fast then Strong');
    fireEvent.change(nameInput, { target: { value: 'Renamed Chain' } });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(writeChain).toHaveBeenCalledWith(
        'fast-to-strong',
        expect.objectContaining({ name: 'Renamed Chain' }),
        'c1',
        'project',
      );
    });
  });
});

describe('SpecialistsPage with Chains tab', () => {
  it('views shared chains read-only and creates and removes a project override', async () => {
    let current = sharedChain;
    const api = fakeApi({
      config: vi.fn(async () => configView({ chains: [current] })),
      writeChain: vi.fn(async (_slug, value) => {
        current = {
          ...sharedChain,
          ...chainFixture,
          level: 'project_over_global',
          raw: value,
          sources: {
            ...sharedChain.sources,
            project: { ...chainFixture.sources.project!, raw: value },
          },
        };
        return { ok: true as const, revision: 'c1', file: current.file };
      }),
      deleteChain: vi.fn(async () => {
        current = sharedChain;
        return { ok: true as const, revision: null, file: chainFixture.file };
      }),
    });
    render(
      <SpecialistsPage api={api} selected={sharedChain.slug} section="chains" onSelect={vi.fn()} />,
    );

    const name = await screen.findByLabelText<HTMLInputElement>('Name');
    expect(name.disabled).toBe(true);
    expect(screen.getAllByRole<HTMLInputElement>('textbox').every((f) => f.disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete chain' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add runtime' }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Override in the project' }));

    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        sharedChain.slug,
        sharedChain.raw,
        null,
        'project',
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(false),
    );
    expect(screen.queryByRole('button', { name: 'Override in the project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the override' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the override' }));
    await waitFor(() =>
      expect(api.deleteChain).toHaveBeenCalledWith(sharedChain.slug, 'c1', 'project'),
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true),
    );
  });

  it('creates new chains only in the project', async () => {
    const api = fakeApi();
    render(<SpecialistsPage api={api} selected="new" section="chains" onSelect={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'project-chain' } });
    expect(screen.queryByText('Global', { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        'project-chain',
        expect.any(Object),
        null,
        'project',
      ),
    );
  });

  it('switches between specialists and chains tabs', async () => {
    const onSelect = vi.fn();
    const api = fakeApi({
      config: vi.fn(async () => configView({ chains: [chainFixture] })),
    });

    const { rerender } = render(
      <SpecialistsPage api={api} selected={null} section={null} onSelect={onSelect} />,
    );

    expect(await screen.findByRole('button', { name: 'New specialist' })).toBeTruthy();

    rerender(<SpecialistsPage api={api} selected={null} section="chains" onSelect={onSelect} />);

    expect(screen.getAllByRole('button', { name: 'New chain' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fast then Strong').length).toBeGreaterThan(0);
  });
});

describe('shared chains in Settings', () => {
  it('loads the model catalog and offers models in the chain elements', async () => {
    const api = fakeApi();
    render(
      <SharedChainsGroup
        api={api}
        config={configView({ chains: [sharedChain] })}
        selected={sharedChain.slug}
        dirty={{ current: false }}
        onSelect={vi.fn()}
        onReload={vi.fn(async () => undefined)}
      />,
    );
    await waitFor(() => expect(api.models).toHaveBeenCalled());
    const pickers = await screen.findAllByRole('combobox', { name: 'Model' });
    fireEvent.click(pickers[0]!);
    expect(await screen.findByRole('option', { name: 'sonnet' })).toBeTruthy();
  });

  it('saves an existing shared chain with its own revision, including the next save', async () => {
    const api = fakeApi();
    const props = {
      api,
      selected: sharedChain.slug,
      dirty: { current: false },
      onSelect: vi.fn(),
      onReload: vi.fn(async () => undefined),
    };
    const { rerender } = render(
      <SharedChainsGroup {...props} config={configView({ chains: [sharedChain] })} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        sharedChain.slug,
        expect.objectContaining({ name: 'First save' }),
        'g1',
        'global',
      ),
    );
    const raw = { ...sharedChain.raw, name: 'First save' };
    const updated: EditorChain = {
      ...sharedChain,
      raw,
      sources: { global: { ...sharedChain.sources.global!, raw, revision: 'g2' } },
    };
    rerender(<SharedChainsGroup {...props} config={configView({ chains: [updated] })} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Second save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        sharedChain.slug,
        expect.objectContaining({ name: 'Second save' }),
        'g2',
        'global',
      ),
    );
  });

  it('edits the shared source even when the project overrides it', async () => {
    const projectRaw = { ...chainFixture.raw, name: 'Project override', mode: 'random' };
    const chain: EditorChain = {
      ...chainFixture,
      level: 'project_over_global',
      raw: projectRaw,
      sources: {
        ...sharedChain.sources,
        project: { ...chainFixture.sources.project!, raw: projectRaw },
      },
    };
    const api = fakeApi();
    render(
      <SharedChainsGroup
        api={api}
        config={configView({ chains: [chain] })}
        selected={chain.slug}
        dirty={{ current: false }}
        onSelect={vi.fn()}
        onReload={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Fast then Strong');
    expect(screen.queryByText('Project override')).toBeNull();
    expect(screen.getByText(sharedChain.file)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Shared edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chain.slug,
        { ...sharedChain.raw, name: 'Shared edit' },
        'g1',
        'global',
      ),
    );
  });
});

const tierRaw = {
  name: 'Thinking',
  mode: 'by_provider',
  enabled: true,
  runtimes: [
    { runtime: 'claude', model: 'opus', enabled: true, provider: 'anthropic' },
    { runtime: 'opencode', model: 'zai/glm-5.3', enabled: true, provider: 'zai', default: true },
  ],
};

const tierFixture: EditorChain = {
  slug: 'thinking',
  level: 'project',
  file: '/repo/aip/chains/thinking.yaml',
  revision: 't1',
  raw: tierRaw,
  sources: { project: { file: '/repo/aip/chains/thinking.yaml', revision: 't1', raw: tierRaw } },
};

const providerButtons = () =>
  screen.getAllByRole<HTMLButtonElement>('combobox', { name: 'Provider' });

/** The API of a project with the providers `anthropic` «Anthropic» and `zai` «Z.ai». */
function registryApi(overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    providers: vi.fn(async () =>
      providersView({
        providers: [
          providerView('anthropic', { name: 'Anthropic' }),
          providerView('zai', { name: 'Z.ai' }),
        ],
      }),
    ),
    ...overrides,
  });
}

function renderTier(api = fakeApi()) {
  render(
    <ChainForm
      api={api}
      chain={tierFixture}
      onDirty={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
    />,
  );
  return api;
}

describe('a chain in the By provider mode', () => {
  it('reads provider and default into the draft and writes them back', () => {
    const draft = draftOfChain(tierFixture);
    expect(draft.mode).toBe('by_provider');
    expect(draft.runtimes.map((item) => [item.provider, item.default])).toEqual([
      ['anthropic', false],
      ['zai', true],
    ]);
    expect(valueOfChain(draft, tierRaw)).toEqual(tierRaw);
  });

  it('keeps provider and drops default when the mode is not By provider', () => {
    const draft = { ...draftOfChain(tierFixture), mode: 'on_error' as const };
    const value = valueOfChain(draft) as { runtimes: Record<string, unknown>[] };
    expect(value.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai']);
    expect(value.runtimes.every((item) => !('default' in item))).toBe(true);
  });

  it('labels the mode By provider and not with the word level', () => {
    render(
      <ChainsList
        chains={[tierFixture]}
        loaded={true}
        selected={null}
        onNew={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/thinking · By provider · 2/)).toBeTruthy();
  });

  it('shows the provider fields and one Default switch at a time, and saves the file shape', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 't2',
      file: '/f',
    }));
    renderTier(registryApi({ writeChain }));
    await waitFor(() => expect(providerButtons().every((button) => !button.disabled)).toBe(true));
    expect(providerButtons().map((button) => button.dataset.providerValue)).toEqual([
      'anthropic',
      'zai',
    ]);
    expect(providerButtons().map((button) => button.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Z.ai')]),
    );
    const switches = screen.getAllByRole('switch', { name: 'Default' });
    expect(switches.map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    fireEvent.click(switches[0]!);
    expect(
      screen
        .getAllByRole('switch', { name: 'Default' })
        .map((el) => el.getAttribute('aria-checked')),
    ).toEqual(['true', 'false']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as typeof tierRaw & {
      runtimes: Record<string, unknown>[];
    };
    expect(saved.mode).toBe('by_provider');
    expect(saved.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai']);
    expect(saved.runtimes.map((item) => 'default' in item)).toEqual([true, false]);
  });

  it('removes default from the items when the mode changes', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 't2',
      file: '/f',
    }));
    renderTier(fakeApi({ writeChain }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Execution mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'On error' }));
    expect(screen.queryByRole('switch', { name: 'Default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as {
      mode: string;
      runtimes: Record<string, unknown>[];
    };
    expect(saved.mode).toBe('on_error');
    expect(saved.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai']);
    expect(saved.runtimes.some((item) => 'default' in item)).toBe(false);
  });

  it('shows a validation error at the provider field of the item', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [
        {
          file: '/f',
          path: 'swarm.chains.thinking.runtimes[1].provider',
          message: 'duplicate provider `zai`',
        },
      ],
    }));
    renderTier(registryApi({ writeChain }));
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    fireEvent.click(providerButtons()[0]!);
    fireEvent.click(await screen.findByRole('option', { name: /Z\.ai/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const message = await screen.findByText('duplicate provider `zai`');
    expect(message.closest('div')?.querySelector('#chain-item-1-provider')).not.toBeNull();
    expect(screen.getAllByText('duplicate provider `zai`')).toHaveLength(1);
  });

  it('shows a provider that is not in the registry with a note', async () => {
    const api = fakeApi({
      providers: vi.fn(async () =>
        providersView({ providers: [providerView('zai', { name: 'Z.ai' })] }),
      ),
    });
    renderTier(api);
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    const old = providerButtons()[0]!;
    expect(old.dataset.providerValue).toBe('anthropic');
    expect(old.textContent).toContain('unknown provider');
  });

  it('offers «No provider» outside the By provider mode', async () => {
    renderTier(registryApi());
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    fireEvent.click(screen.getByRole('combobox', { name: 'Execution mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'On error' }));
    fireEvent.click(providerButtons()[0]!);
    expect(await screen.findByRole('option', { name: /No provider/ })).toBeTruthy();
  });

  it('creates a provider from the combobox of an item and chooses it', async () => {
    const created: Record<string, unknown>[] = [];
    const providers = vi.fn(async () =>
      providersView({
        providers: [
          providerView('anthropic', { name: 'Anthropic' }),
          ...created.map((value) => providerView('corp', { name: String(value.name) })),
        ],
      }),
    );
    const writeProvider = vi.fn(async (_slug: string, value: Record<string, unknown>) => {
      created.push(value);
      return { ok: true as const, revision: 'n', file: '/f' };
    });
    renderTier(fakeApi({ providers, writeProvider, config: vi.fn(async () => configView()) }));
    await waitFor(() => expect(providerButtons()[1]!.disabled).toBe(false));
    fireEvent.click(providerButtons()[1]!);
    fireEvent.change(await screen.findByPlaceholderText('Name or slug'), {
      target: { value: 'Corp' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Create provider/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New provider' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Corp');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeProvider).toHaveBeenCalledWith('corp', expect.anything(), null, 'global'),
    );
    await waitFor(() => expect(providerButtons()[1]!.dataset.providerValue).toBe('corp'));
  });
});
