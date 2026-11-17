// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { ConfigEditorResponse, EditorSpecialist, RunView } from '../src/shared/api/types.ts';

import {
  FakeEventSource,
  actionEntry,
  configView,
  fakeApi,
  openFake,
  pipelinesView,
  queueItem,
  queueOf,
  repositoryView,
  runView,
  specialistEntry,
  specialistUse,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

const APP = '/work/app';
const LIB = '/work/lib';

beforeAll(() => {
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

beforeEach(() => {
  window.location.hash = '#runs';
  window.localStorage.clear();
  window.localStorage.setItem('aip.web.repository', JSON.stringify(APP));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const trigger = () => document.querySelector<HTMLElement>('[data-repository-trigger]')!;
const label = () => trigger().getAttribute('aria-label');
const modeOn = () => window.localStorage.setItem('aip.web.projects.all', 'true');

const shared = (slug: string, name = slug.toUpperCase()): EditorSpecialist =>
  specialistEntry(slug, { level: 'global', raw: { name } }, { name });
const own = (slug: string, name: string): EditorSpecialist =>
  specialistEntry(slug, { level: 'project', raw: { name } }, { name });

type Setup = {
  configs?: Record<string, ConfigEditorResponse | Error>;
  runs?: RunView[];
  repositories?: ReturnType<typeof repositoryView>[];
};

function mount(setup: Setup = {}) {
  const configs = setup.configs ?? {
    [APP]: configView({
      repository: APP,
      specialists: [shared('coder'), own('tester', 'Tester app')],
    }),
    [LIB]: configView({ repository: LIB, specialists: [shared('coder'), own('docs', 'Docs lib')] }),
  };
  const base = fakeApi({ runs: vi.fn(async () => []) });
  const bound = (repository: string | null): Api => {
    const scoped = base.forRepository(repository);
    return {
      ...scoped,
      forRepository: bound,
      config: async () => {
        await scoped.config();
        const config = configs[repository ?? APP] ?? configView({ repository: repository ?? APP });
        if (config instanceof Error) throw config;
        return config;
      },
      pipelines: async () => {
        await scoped.pipelines();
        return pipelinesView({ repository: repository ?? APP });
      },
    };
  };
  const api = { ...base, forRepository: bound } as Api;
  render(<App api={api} openStream={openFake} />);
  act(() => {
    FakeEventSource.last?.send({
      event: 'snapshot',
      seq: 1,
      runs: setup.runs ?? [],
      queues: [queueOf({ repository: APP }), queueOf({ repository: LIB })],
      repositories: setup.repositories ?? [repositoryView(APP), repositoryView(LIB)],
    });
  });
  return { base, calls: (base as unknown as { calls: [string, string | null][] }).calls };
}

async function chooseInMenu(name: string | RegExp) {
  fireEvent.keyDown(trigger(), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name }));
}

describe('the mode «All projects»', () => {
  it('is off at the first opening and does not follow the old scope of the runs', async () => {
    window.localStorage.setItem('aip.web.runs.scope', JSON.stringify('all'));
    mount({ runs: [runView({ id: 'l1', repository: LIB, title: 'lib run' })] });
    await waitFor(() => expect(label()).toBe('Repository: app'));
    expect(screen.queryByText('lib run')).toBeNull();
  });

  it('is remembered and keeps the last chosen project', async () => {
    mount();
    await waitFor(() => expect(label()).toBe('Repository: app'));
    await chooseInMenu('All projects');
    await waitFor(() => expect(label()).toBe('Repository: All projects'));
    expect(window.localStorage.getItem('aip.web.projects.all')).toBe('true');
    expect(window.localStorage.getItem('aip.web.repository')).toBe(JSON.stringify(APP));
    cleanup();
    mount();
    await waitFor(() => expect(label()).toBe('Repository: All projects'));
  });

  it('is left by choosing a project', async () => {
    modeOn();
    mount();
    await waitFor(() => expect(label()).toBe('Repository: All projects'));
    await chooseInMenu(/lib/);
    await waitFor(() => expect(label()).toBe('Repository: lib'));
    expect(window.localStorage.getItem('aip.web.projects.all')).toBe('false');
  });

  it('is off when there is no enabled project', async () => {
    modeOn();
    mount({ repositories: [repositoryView(APP, { enabled: false })] });
    await waitFor(() => expect(label()).not.toBe('Repository: All projects'));
  });

  it('counts the sections over every project', async () => {
    modeOn();
    mount({
      runs: [
        runView({ id: 'a1', repository: APP }),
        runView({ id: 'l1', repository: LIB, state: 'needs_human', waiting: 1 }),
      ],
    });
    const runsLink = await screen.findByRole('link', { name: /Runs/ });
    await waitFor(() =>
      expect(
        within(runsLink).getAllByLabelText('running: 2, waiting for an answer: 1').length,
      ).toBeGreaterThan(0),
    );
    act(() => {
      FakeEventSource.last?.send({
        event: 'queue',
        seq: 2,
        queue: queueOf({
          repository: APP,
          items: [queueItem('a', 'x', 1), queueItem('b', 'y', 2)],
        }),
      });
      FakeEventSource.last?.send({
        event: 'queue',
        seq: 3,
        queue: queueOf({ repository: LIB, items: [queueItem('c', 'z', 1)] }),
      });
    });
    const queueLink = screen.getByRole('link', { name: /Queue/ });
    await waitFor(() => expect(queueLink.textContent).toContain('3'));
  });
});

describe('addresses in the mode', () => {
  const libRun = runView({ id: 'l1', repository: LIB, title: 'lib run' });

  it('opens a run of another project and keeps the mode', async () => {
    modeOn();
    window.location.hash = '#runs/l1';
    mount({ runs: [libRun] });
    await waitFor(() => expect(window.location.hash).toBe('#runs/l1'));
    expect(label()).toBe('Repository: All projects');
  });

  it('selects the project of a run outside the mode', async () => {
    window.location.hash = '#runs/l1';
    mount({ runs: [libRun] });
    await waitFor(() => expect(label()).toBe('Repository: lib'));
  });

  it('selects the project of a specialist outside the mode', async () => {
    window.location.hash = '#specialists/docs?project=lib';
    mount();
    await waitFor(() => expect(label()).toBe('Repository: lib'));
  });

  it('opens the group of a row by its slug without a project', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    fireEvent.click(await screen.findByText('Docs lib'));
    await waitFor(() => expect(window.location.hash).toBe('#specialists/docs'));
    expect(label()).toBe('Repository: All projects');
  });

  it('opens the group and marks the block of the project of an old address', async () => {
    modeOn();
    window.location.hash = '#specialists/docs?project=lib';
    mount();
    const block = await waitFor(() => {
      const found = document.querySelector('[data-overview-project="lib"]');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(block.getAttribute('data-highlighted')).toBe('true');
    expect(label()).toBe('Repository: All projects');
  });

  it('says so about an unknown project and still shows the list', async () => {
    modeOn();
    window.location.hash = '#specialists/tester?project=nope';
    mount();
    expect((await screen.findByRole('alert')).textContent).toBe('Project not found');
    expect((await screen.findAllByText('Tester app')).length).toBeGreaterThan(0);
  });

  it('opens the form of the same entry when a project is chosen in the header', async () => {
    modeOn();
    window.location.hash = '#specialists/tester';
    mount();
    await screen.findByRole('region', { name: 'Tester app' });
    await chooseInMenu(/app/);
    await waitFor(() => expect(label()).toBe('Repository: app'));
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Tester app'),
    );
    expect(window.location.hash).toBe('#specialists/tester');
  });
});

describe('specialists in the mode', () => {
  const twoTesters = {
    [APP]: configView({ repository: APP, specialists: [own('tester', 'Tester app')] }),
    [LIB]: configView({ repository: LIB, specialists: [own('tester', 'Tester lib')] }),
  };

  it('groups the shared one once with «In all projects» and projects under the others', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    await screen.findByText('Tester app');
    expect(screen.getAllByText('CODER')).toHaveLength(1);
    const coder = screen.getByText('CODER').closest('li, a, button')!;
    expect(coder.querySelector('[data-project-chips="everywhere"]')?.textContent).toBe(
      'In all projects',
    );
    const docs = screen.getByText('Docs lib').closest('li, a, button')!;
    expect(docs.querySelector('[data-project-label="lib"]')).toBeTruthy();
    expect(docs.querySelector('[data-project-label="app"]')).toBeNull();
  });

  it('shows one slug of two projects as one row with both projects', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount({ configs: twoTesters });
    const row = (await screen.findByText('Tester app')).closest('li, a, button')!;
    expect(screen.queryByText('Tester lib')).toBeNull();
    expect(row.querySelector('[data-project-label="app"]')).toBeTruthy();
    expect(row.querySelector('[data-project-label="lib"]')).toBeTruthy();
  });

  it('marks a project that overrides the shared one', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount({
      configs: {
        [APP]: configView({
          repository: APP,
          specialists: [
            specialistEntry('coder', { level: 'project_over_global', raw: { name: 'CODER' } }),
          ],
        }),
        [LIB]: configView({ repository: LIB, specialists: [shared('coder')] }),
      },
    });
    const row = (await screen.findByText('CODER')).closest('li, a, button')!;
    expect(row.querySelector('[data-project-chips="projects"]')).toBeTruthy();
    expect(row.textContent).toContain('Project · overrides shared');
  });

  it('shows the error of a project and the rows of the others', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount({
      configs: {
        [APP]: configView({ repository: APP, specialists: [own('tester', 'Tester app')] }),
        [LIB]: new Error('no such directory'),
      },
    });
    await screen.findByText('Tester app');
    expect(screen.getByText('lib: no such directory')).toBeTruthy();
  });

  const enabledFields = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-entry-overview] :is(input, textarea, select)'),
    ).filter((field) => !(field as HTMLInputElement).disabled);
  const writeButtons = /^(Save|Save as|Override|Make shared|Delete|Remove|Reset)$/;

  it('shows a compact list of projects with a disabled preview instead of a form', async () => {
    modeOn();
    window.location.hash = '#specialists/tester';
    mount({ configs: twoTesters });
    const overview = await screen.findByRole('region', { name: 'Tester app' });
    expect(overview.querySelector('[data-overview-project="app"]')).toBeTruthy();
    expect(overview.querySelector('[data-overview-project="lib"]')).toBeTruthy();
    const preview = await waitFor(() => {
      const found = overview.querySelector('[data-entry-preview]');
      expect(found).toBeTruthy();
      return found!;
    });
    expect(preview.getAttribute('data-entry-preview')).toBe('app');
    expect(within(overview).getByText('Configuration in project app')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(enabledFields().map((f) => f.outerHTML)).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });

  it('names only the projects in the list', async () => {
    modeOn();
    window.location.hash = '#specialists/coder';
    mount({
      configs: {
        [APP]: configView({ repository: APP, specialists: [shared('coder')] }),
        [LIB]: configView({ repository: LIB, specialists: [shared('coder')] }),
      },
    });
    await screen.findByRole('region', { name: 'CODER' });
    for (const slug of ['app', 'lib']) {
      const row = document.querySelector<HTMLElement>(`[data-overview-project="${slug}"]`)!;
      expect(row.textContent).toBe(`${slug}Open in project ${slug}`);
    }
  });

  it('switches the preview to another project without leaving the mode', async () => {
    modeOn();
    window.location.hash = '#specialists/tester';
    mount({ configs: twoTesters });
    await screen.findByRole('region', { name: 'Tester app' });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Tester app'),
    );
    const lib = document.querySelector<HTMLElement>('[data-overview-project="lib"]')!;
    fireEvent.click(within(lib).getByRole('button', { name: /^lib/ }));
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Tester lib'),
    );
    expect(lib.getAttribute('data-active')).toBe('true');
    expect(label()).toBe('Repository: All projects');
    expect(window.location.hash).toBe('#specialists/tester');
    expect(enabledFields().map((f) => f.outerHTML)).toEqual([]);
  });

  it('previews the project of the address', async () => {
    modeOn();
    window.location.hash = '#specialists/tester?project=lib';
    mount({ configs: twoTesters });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Tester lib'),
    );
    expect(
      document.querySelector('[data-overview-project="lib"]')?.getAttribute('data-highlighted'),
    ).toBe('true');
  });

  it('changes nothing in the mode: no enabled fields, no writes', async () => {
    modeOn();
    window.location.hash = '#specialists/tester';
    const { calls } = mount({ configs: twoTesters });
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
    expect(enabledFields().map((f) => f.outerHTML)).toEqual([]);
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent).not.toMatch(writeButtons);
    }
    expect(
      calls.filter(([name]) => /save|write|remove|delete|override|create/i.test(name)),
    ).toEqual([]);
  });

  it('has no creation or import in the mode', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    await screen.findByText('Tester app');
    expect(screen.queryByRole('button', { name: /New specialist/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Import/ })).toBeNull();
    expect(screen.getByText('To change, choose a project')).toBeTruthy();
  });

  it('narrows the list by the filter «Project»', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    await screen.findByText('Tester app');
    fireEvent.click(await screen.findByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() => expect(screen.queryByText('Tester app')).toBeNull());
    expect(screen.getByText('Docs lib')).toBeTruthy();
  });

  it('opens the entry in the project: leaves the mode, selects the project, opens the form', async () => {
    modeOn();
    window.location.hash = '#specialists/docs';
    mount();
    const overview = await screen.findByRole('region', { name: 'Docs lib' });
    fireEvent.click(within(overview).getByRole('button', { name: /Open in project/ }));
    await waitFor(() => expect(label()).toBe('Repository: lib'));
    expect(window.localStorage.getItem('aip.web.projects.all')).toBe('false');
    expect(window.location.hash).toBe('#specialists/docs');
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Docs lib'),
    );
  });
});

describe('pipelines in the mode', () => {
  const pipeline = (id: string, level: 'project' | 'global', name: string) => ({
    id,
    level,
    file: `/x/${id}.yaml`,
    revision: `r-${id}`,
    raw: { name, steps: [{ id: 'code', specialist: 'coder' }] },
    shared_tags: [],
    own_tags: [],
    sources: {},
  });

  it('groups the pipelines of two projects and shows an overview of the open one', async () => {
    modeOn();
    window.location.hash = '#pipelines';
    mount({
      configs: {
        [APP]: configView({
          repository: APP,
          specialists: [shared('coder')],
          pipelines: [pipeline('feature', 'project', 'Feature app') as never],
        }),
        [LIB]: configView({
          repository: LIB,
          specialists: [shared('coder')],
          pipelines: [
            pipeline('feature', 'project', 'Feature lib') as never,
            pipeline('explore', 'global', 'Exploration') as never,
          ],
        }),
      },
    });
    const row = (await screen.findByText('Feature app')).closest('li, a, button')!;
    expect(screen.queryByText('Feature lib')).toBeNull();
    expect(row.querySelector('[data-project-label="app"]')).toBeTruthy();
    expect(row.querySelector('[data-project-label="lib"]')).toBeTruthy();
    expect(screen.getAllByText('Exploration')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /New pipeline/ })).toBeNull();
    fireEvent.click(row.querySelector('button, a') ?? row);
    const overview = await screen.findByRole('region', { name: 'Feature app' });
    expect(overview.querySelectorAll('[data-overview-project]')).toHaveLength(2);
    fireEvent.click(
      within(overview.querySelector<HTMLElement>('[data-overview-project="lib"]')!).getByRole(
        'button',
        { name: /Open in project/ },
      ),
    );
    await waitFor(() => expect(label()).toBe('Repository: lib'));
    expect(window.location.hash).toBe('#pipelines/feature');
  });

  it('offers the project in the topology and keeps the mode', async () => {
    modeOn();
    window.location.hash = '#pipelines/topology/feature';
    const { calls } = mount();
    const picker = await screen.findByRole('combobox', { name: 'Project' });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() => expect(calls).toContainEqual(['pipelines', LIB]));
    expect(label()).toBe('Repository: All projects');
  });
});

describe('chains and actions in the mode', () => {
  const chain = (name: string) => {
    const raw = { name, mode: 'on_error', enabled: true, runtimes: [{ provider: 'zai' }] };
    return {
      slug: 'fast',
      level: 'project' as const,
      file: '/x/fast.yaml',
      revision: 'c',
      raw,
      sources: {},
    };
  };

  it('groups a chain of two projects and opens an overview without creation', async () => {
    modeOn();
    window.location.hash = '#specialists/chains';
    mount({
      configs: {
        [APP]: configView({ repository: APP, chains: [chain('Fast app') as never] }),
        [LIB]: configView({ repository: LIB, chains: [chain('Fast lib') as never] }),
      },
    });
    const row = (await screen.findByText('Fast app')).closest('li, a, button')!;
    expect(screen.queryByText('Fast lib')).toBeNull();
    expect(row.querySelector('[data-project-label="lib"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New chain/ })).toBeNull();
    fireEvent.click(row.querySelector('button, a') ?? row);
    await waitFor(() => expect(window.location.hash).toBe('#specialists/chains/fast'));
    const overview = await screen.findByRole('region', { name: 'Fast app' });
    fireEvent.click(
      within(overview.querySelector<HTMLElement>('[data-overview-project="lib"]')!).getByRole(
        'button',
        { name: /Open in project/ },
      ),
    );
    await waitFor(() => expect(label()).toBe('Repository: lib'));
    expect(window.location.hash).toBe('#specialists/chains/fast');
  });

  it('previews a chain with disabled fields and no buttons of writing', async () => {
    modeOn();
    window.location.hash = '#specialists/chains/fast';
    mount({
      configs: {
        [APP]: configView({ repository: APP, chains: [chain('Fast app') as never] }),
        [LIB]: configView({ repository: LIB, chains: [chain('Fast lib') as never] }),
      },
    });
    const overview = await screen.findByRole('region', { name: 'Fast app' });
    await waitFor(() => expect(overview.querySelector('[data-entry-preview="app"]')).toBeTruthy());
    const fields = Array.from(
      overview.querySelectorAll<HTMLInputElement>('input, textarea, select'),
    );
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.filter((field) => !field.disabled)).toEqual([]);
    for (const name of [/^Save/, /^Reset/, /^Override/, /^Delete$/, /^Remove$/]) {
      expect(within(overview).queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows an action as an overview', async () => {
    modeOn();
    window.location.hash = '#pipelines/actions/notify';
    const action = actionEntry('notify', { name: 'Notify', command: 'echo hi' });
    mount({
      configs: {
        [APP]: configView({ repository: APP, actions: [action] }),
        [LIB]: configView({ repository: LIB, actions: [action] }),
      },
    });
    const overview = await screen.findByRole('region', { name: 'Notify' });
    expect(overview.querySelectorAll('[data-overview-project]')).toHaveLength(2);
    expect(within(overview).getAllByText('command: echo hi').length).toBe(2);
    expect(screen.queryByRole('button', { name: /New action/ })).toBeNull();
  });
});

describe('the swarm window in the mode', () => {
  const editing = [
    /^New (specialist|chain|pipeline|action)/,
    /Import/,
    /^Save/,
    /^Delete/,
    /Add role/,
    /Create provider/,
    /^Rename/,
  ];

  it.each(['#providers', '#providers/roles', '#specialists', '#specialists/chains', '#pipelines'])(
    'changes nothing on %s',
    async (hash) => {
      modeOn();
      window.location.hash = hash;
      mount();
      await waitFor(() => expect(label()).toBe('Repository: All projects'));
      await screen.findByRole('tablist', { name: 'Swarm tabs' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const name of editing) expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.queryByLabelText('Name')).toBeNull();
    },
  );

  it('opens the form of the settings without the mode', async () => {
    modeOn();
    window.location.hash = '#settings/project/swarm/specialists/coder';
    mount();
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeTruthy());
  });
});

describe('the status strip in the mode', () => {
  const runs = () => [
    runView({
      id: 'r1',
      repository: LIB,
      specialists: [specialistUse('docs', { level: 'project', running: ['a'] })],
    }),
    runView({
      id: 'r2',
      repository: APP,
      specialists: [specialistUse('tester', { level: 'project', running: ['b'] })],
    }),
  ];
  const order = () =>
    [
      ...document.querySelectorAll(
        'section[aria-label="Project"] [title="/work/app"], section[aria-label="Project"] [title="/work/lib"]',
      ),
    ].map((node) => node.getAttribute('title'));

  it('puts the selected project first outside the mode and orders by name inside it', async () => {
    window.localStorage.setItem('aip.web.repository', JSON.stringify(LIB));
    window.localStorage.setItem('aip.web.specialistLoad.open', 'true');
    mount({ runs: runs() });
    await waitFor(() => expect(label()).toBe('Repository: lib'));
    await waitFor(() => expect(order()[0]).toBe(LIB));
    cleanup();
    modeOn();
    mount({ runs: runs() });
    await waitFor(() => expect(label()).toBe('Repository: All projects'));
    await waitFor(() => expect(order()[0]).toBe(APP));
    expect(order()).toEqual([APP, LIB]);
  });
});

describe('the new task dialog in the mode', () => {
  it('starts on the last chosen project', async () => {
    window.localStorage.setItem('aip.web.repository', JSON.stringify(LIB));
    modeOn();
    mount();
    await waitFor(() => expect(label()).toBe('Repository: All projects'));
    const button = within(screen.getAllByRole('banner')[0]!).getByRole<HTMLButtonElement>(
      'button',
      {
        name: 'New task',
      },
    );
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(dialog).getByRole('combobox', { name: 'Repository' }).textContent).toContain(
      'lib',
    );
  });
});
