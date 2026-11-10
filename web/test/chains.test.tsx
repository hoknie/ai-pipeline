// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
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
    expect(screen.getAllByDisplayValue('openai/gpt-custom')).toHaveLength(1);
    expect(screen.getAllByDisplayValue('OtherProvider/team/GPT-Custom')).toHaveLength(1);
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
