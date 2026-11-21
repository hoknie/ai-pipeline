// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import { forgetSwarm } from '../src/features/swarm/index.ts';
import {
  FakeSocket,
  configView,
  fakeApi,
  openFake,
  queueOf,
  runView,
  specialistEntry,
} from './fixtures.ts';
import { editorProvider, providersView, providerView, roleView } from './providerFixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

beforeEach(() => {
  window.location.hash = '';
  forgetSwarm();
});
afterEach(() => cleanup());

const source = (raw: Record<string, unknown>) => ({ file: '/repo/aip/x.yaml', revision: 'r', raw });

/** A configuration where `zai` is in the second item of `thinking`, run by `coder` of `feature`. */
function usedConfig() {
  const chain = {
    name: 'Thinking',
    runtimes: [
      { provider: 'anthropic', runtime: 'claude' },
      { provider: 'zai', runtime: 'claude' },
    ],
  };
  const feature = { name: 'Feature', steps: [{ id: 'code', specialist: 'coder' }] };
  return configView({
    chains: [
      {
        slug: 'thinking',
        level: 'project',
        file: '/repo/aip/chains/thinking.yaml',
        revision: 'c1',
        raw: chain,
        sources: { project: source(chain) },
      },
    ],
    specialists: [
      specialistEntry('coder', {
        raw: { name: 'Coder', runtime_chain: 'thinking' },
      }),
    ],
    pipelines: [
      {
        id: 'feature',
        level: 'project',
        file: '/repo/aip/pipelines/feature.yaml',
        revision: 'p1',
        raw: feature,
        sources: { project: source(feature) },
        shared_tags: [],
        own_tags: [],
      },
    ],
    providers: [
      editorProvider('zai', { name: 'Z.ai', access: [{ kind: 'cli', runtime: 'claude' }] }),
      editorProvider('anthropic', { name: 'Anthropic' }),
    ],
  } as never);
}

function mount(hash: string, overrides: Parameters<typeof fakeApi>[0] = {}) {
  window.location.hash = hash;
  const api = fakeApi({
    queue: vi.fn(async () => queueOf()),
    config: vi.fn(async () => usedConfig()),
    providers: vi.fn(async () =>
      providersView({
        roles: [roleView('code', 'Code')],
        providers: [providerView('zai', { name: 'Z.ai' }), providerView('anthropic')],
      }),
    ),
    ...overrides,
  });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeSocket.last!.send({ event: 'snapshot', seq: 1, runs: [runView()] }));
  return api;
}

const tabs = () => within(screen.getByRole('tablist', { name: 'Swarm tabs' }));

describe('the window «Swarm» of the top bar', () => {
  it('has the five tabs in the order of the entities and marks the open one', async () => {
    mount('#specialists');
    await screen.findByRole('button', { name: 'New specialist' });
    expect(
      tabs()
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Providers', 'Roles', 'Chains', 'Specialists', 'Pipeline']);
    expect(tabs().getByRole('tab', { name: 'Specialists' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('link', { name: 'Swarm' }).getAttribute('aria-current')).toBe('page');
  });

  it('switches tabs by the addresses that were there before', async () => {
    mount('#specialists');
    await screen.findByRole('button', { name: 'New specialist' });
    fireEvent.click(tabs().getByRole('tab', { name: 'Providers' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers'));
    fireEvent.click(tabs().getByRole('tab', { name: 'Roles' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers/roles'));
    fireEvent.click(tabs().getByRole('tab', { name: 'Chains' }));
    await waitFor(() => expect(window.location.hash).toBe('#specialists/chains'));
    fireEvent.click(tabs().getByRole('tab', { name: 'Pipeline' }));
    await waitFor(() => expect(window.location.hash).toBe('#pipelines'));
  });

  it('comes back to the entry a tab was left on', async () => {
    mount('#providers/zai');
    expect(await screen.findByRole('heading', { name: 'Z.ai' })).toBeTruthy();
    fireEvent.click(tabs().getByRole('tab', { name: 'Specialists' }));
    await waitFor(() => expect(window.location.hash).toBe('#specialists'));
    fireEvent.click(tabs().getByRole('tab', { name: 'Providers' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers/zai'));
  });

  it('returns to the list of the tab when its own tab is clicked inside an open entry', async () => {
    mount('#providers/zai');
    expect(await screen.findByRole('heading', { name: 'Z.ai' })).toBeTruthy();
    fireEvent.click(tabs().getByRole('tab', { name: 'Providers' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers'));
    expect(screen.queryByRole('heading', { name: 'Z.ai' })).toBeNull();
  });

  it('asks before leaving a form with unsaved edits and stays on a refusal', async () => {
    mount('#specialists/coder');
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Edited' } });
    fireEvent.click(tabs().getByRole('tab', { name: 'Providers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay' }));
    expect(window.location.hash).toBe('#specialists/coder');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Edited');
    fireEvent.click(tabs().getByRole('tab', { name: 'Providers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers'));
  });

  it('has no block «Where it is used» on the page of a provider', async () => {
    mount('#providers/zai');
    expect(await screen.findByRole('heading', { name: 'Z.ai' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Where it is used' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Specialist Coder' })).toBeNull();
  });
});

describe('the hints of the empty tabs', () => {
  it('asks to create a provider first on the tab «Chains» without chains', async () => {
    mount('#specialists/chains', { config: vi.fn(async () => configView()) });
    expect(await screen.findByText(/Create a provider on the «Providers» tab first/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'To providers' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers'));
  });

  it('explains chains in the empty list of specialists', async () => {
    mount('#specialists', { config: vi.fn(async () => configView({ specialists: [] })) });
    expect(await screen.findByText(/A chain lists providers and models/)).toBeTruthy();
  });
});

describe('the group «Swarm» of the settings', () => {
  it('opens the tabs of the window on both settings tabs', async () => {
    mount('#settings/global/swarm/providers');
    await screen.findByRole('button', { name: 'Create provider' });
    expect(tabs().getByRole('tab', { name: 'Providers' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    cleanup();
    mount('#settings/project/swarm/roles');
    expect(await screen.findByText('Pick a role in the list.')).toBeTruthy();
  });

  it('reads the shared registry alone on the shared tab and the merged one on the project tab', async () => {
    const api = mount('#settings/global/swarm/providers');
    await screen.findByRole('button', { name: 'Create provider' });
    await waitFor(() => expect(api.providers).toHaveBeenCalledWith('global'));
    cleanup();
    const project = mount('#settings/project/swarm/providers');
    await screen.findByRole('button', { name: 'Create provider' });
    await waitFor(() => expect(project.providers).toHaveBeenCalled());
    expect(vi.mocked(project.providers).mock.calls.every(([level]) => level === undefined)).toBe(
      true,
    );
  });

  it('keeps the tab of the window when the settings tab changes and drops the entry', async () => {
    mount('#settings/global/swarm/providers/zai');
    expect(await screen.findByRole('heading', { name: 'Z.ai' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Project' }));
    await waitFor(() => expect(window.location.hash).toBe('#settings/project/swarm/providers'));
    expect(screen.queryByRole('heading', { name: 'Z.ai' })).toBeNull();
  });

  it('shows the project specialist on the project tab', async () => {
    mount('#settings/project/swarm/specialists/coder');
    expect(await screen.findByRole('heading', { name: 'coder' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
  });

  it('shows the shared directory and no project selector on the shared tab', async () => {
    mount('#settings/global/swarm/specialists');
    const region = await screen.findByRole('region', { name: 'Where the settings are saved' });
    expect(within(region).getByText('/xdg/aip')).toBeTruthy();
    expect(within(region).getByText('Applies to every repository')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
  });

  it('shows the level note and no project selector on the project tab', async () => {
    mount('#settings/project/swarm/providers');
    const region = await screen.findByRole('region', { name: 'Where the settings are saved' });
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull();
    expect(within(region).getByText(/Shared entries are view only/)).toBeTruthy();
  });

  it('has no groups of chains, specialists and pipelines beside «Swarm»', async () => {
    mount('#settings/global/swarm/providers');
    await screen.findByRole('button', { name: 'Create provider' });
    const nav = screen.getByRole('navigation', { name: 'groups of settings' });
    for (const name of ['Chains', 'Specialists', 'Pipeline'])
      expect(within(nav).queryByRole('link', { name })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Swarm' })).toBeTruthy();
  });

  it('opens an unknown provider as the tab without a chosen one', async () => {
    mount('#settings/global/swarm/providers/gone');
    expect(await screen.findByText(/Pick a provider in the list/)).toBeTruthy();
  });
});

describe('the shared providers', () => {
  it('opens the form with the preset chosen in the empty state of the shared tab', async () => {
    mount('#settings/global/swarm/providers', {
      providers: vi.fn(async () => providersView()),
    });
    const link = await screen.findByRole('link', { name: 'Z.ai GLM Coding Plan' });
    expect(link.getAttribute('href')).toBe('#settings/global/swarm/providers/new?preset=zai');
    fireEvent.click(link);
    await waitFor(() =>
      expect(window.location.hash).toBe('#settings/global/swarm/providers/new?preset=zai'),
    );
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe(
      'Z.ai GLM Coding Plan',
    );
  });

  it('creates a shared provider without a choice of the level and writes the shared file', async () => {
    const api = mount('#settings/global/swarm/providers/new');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Plain' } });
    expect(screen.queryByLabelText('Level')).toBeNull();
    expect(screen.getByText('A shared provider applies in every repository.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    expect(vi.mocked(api.writeProvider).mock.calls[0]?.[3]).toBe('global');
  });
});

describe('the section «Swarm» of the strip', () => {
  const openPalette = () =>
    fireEvent.keyDown(window, {
      key: 'k',
      metaKey: /Mac|iPhone|iPad/.test(navigator.platform),
      ctrlKey: !/Mac|iPhone|iPad/.test(navigator.platform),
    });

  it('opens «Specialists» the first time and the last tab later', async () => {
    mount('#runs');
    fireEvent.click(screen.getByRole('link', { name: 'Swarm' }));
    await waitFor(() => expect(window.location.hash).toBe('#specialists'));
    fireEvent.click(tabs().getByRole('tab', { name: 'Providers' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers'));
    fireEvent.click(screen.getByRole('link', { name: /Runs/ }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#runs/));
    fireEvent.click(screen.getByRole('link', { name: 'Swarm' }));
    await waitFor(() => expect(window.location.hash).toBe('#providers'));
  });

  it('goes to a tab from the palette', async () => {
    mount('#runs');
    openPalette();
    fireEvent.click(await screen.findByText('Swarm → Roles'));
    await waitFor(() => expect(window.location.hash).toBe('#providers/roles'));
  });
});

describe('the project scope never writes the shared level', () => {
  const shared = (raw: Record<string, unknown>) => ({
    file: '/xdg/aip/x.yaml',
    revision: 'g',
    raw,
  });

  /** Shared-only entries of every kind the window edits. */
  function sharedConfig() {
    const pipeline = { name: 'Quick', steps: [{ id: 'code', specialist: 'coder' }] };
    return configView({
      specialists: [
        specialistEntry('coder', {
          level: 'global',
          file: '/xdg/aip/specialists/coder.yaml',
          revision: null,
          sources: { global: shared({ name: 'Coder' }) },
        }),
      ],
      pipelines: [
        {
          id: 'quick',
          level: 'global',
          file: '/xdg/aip/pipelines/quick.yaml',
          revision: null,
          raw: pipeline,
          sources: { global: shared(pipeline) },
          shared_tags: [],
          own_tags: [],
        },
      ],
      providers: [
        editorProvider('zai', { name: 'Z.ai', access: [{ kind: 'cli', runtime: 'claude' }] }),
      ],
    } as never);
  }

  const methods = [
    'writeProvider',
    'deleteProvider',
    'writeSpecialist',
    'deleteSpecialist',
    'writePipeline',
    'deletePipeline',
    'writeAction',
    'deleteAction',
    'writeChain',
    'deleteChain',
    'writeSetting',
  ] as const;

  const levelsOf = (api: ReturnType<typeof mount>) =>
    methods.flatMap((method) =>
      vi
        .mocked(api[method] as (...args: unknown[]) => unknown)
        .mock.calls.map((call) => ({ method, level: call[call.length - 1] })),
    );

  it.each([
    ['#settings/project/swarm/providers/zai', 'writeProvider'],
    ['#settings/project/swarm/specialists/coder', 'writeSpecialist'],
    ['#settings/project/swarm/pipelines/quick', 'writePipeline'],
  ] as const)(
    'shows a shared entry at %s view only and overrides it at the project level',
    async (hash, method) => {
      const api = mount(hash, { config: vi.fn(async () => sharedConfig()) });
      const override = await screen.findByRole('button', { name: 'Override in the project' });
      for (const name of ['Save', 'Delete', 'Make global']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      fireEvent.click(override);
      await waitFor(() => expect(api[method]).toHaveBeenCalled());
      const levels = levelsOf(api);
      expect(levels.length).toBeGreaterThan(0);
      expect(levels.every((call) => call.level === 'project')).toBe(true);
    },
  );

  it('writes the auto delivery of the queue to the project file when the project does not set it', async () => {
    const api = mount('#settings/project/queue');
    const block = within(await screen.findByRole('region', { name: 'queue settings' }));
    const toggle = await waitFor(() => {
      const found = block.getByRole<HTMLButtonElement>('switch', {
        name: 'Auto delivery by default',
      });
      expect(found.disabled).toBe(false);
      return found;
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(api.writeSetting).toHaveBeenCalled());
    expect(levelsOf(api).every((call) => call.level === 'project')).toBe(true);
  });

  it('writes the copy of a shared provider only at the project level', async () => {
    const api = mount('#settings/project/swarm/providers/zai', {
      config: vi.fn(async () => sharedConfig()),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Override in the project' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    expect(vi.mocked(api.writeProvider).mock.calls.map((call) => call[3])).toEqual(['project']);
  });
});
