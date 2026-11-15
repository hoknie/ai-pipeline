// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App.tsx';
import type { Api } from '../src/shared/api/api.ts';
import type { ConfigEditorResponse, EditorSpecialist, RunView } from '../src/shared/api/types.ts';

import {
  FakeEventSource,
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
      specialists: [shared('coder'), own('tester', 'Тестер app')],
    }),
    [LIB]: configView({ repository: LIB, specialists: [shared('coder'), own('docs', 'Доки lib')] }),
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

  it('opens the specialist of the project and keeps the mode', async () => {
    modeOn();
    window.location.hash = '#specialists/docs?project=lib';
    mount();
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Доки lib'),
    );
    expect(label()).toBe('Repository: All projects');
  });

  it('says so about an unknown project and still shows the list', async () => {
    modeOn();
    window.location.hash = '#specialists/tester?project=nope';
    mount();
    expect((await screen.findByRole('alert')).textContent).toBe('Project not found');
    expect(await screen.findByText('Тестер app')).toBeTruthy();
  });
});

describe('specialists in the mode', () => {
  it('lists the shared ones once and the project ones with their project', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    await screen.findByText('Тестер app');
    expect(screen.getAllByText('CODER')).toHaveLength(1);
    expect(document.querySelector('[data-project-label="app"]')).toBeTruthy();
    expect(document.querySelector('[data-project-label="lib"]')).toBeTruthy();
    expect(screen.getByText('Доки lib')).toBeTruthy();
    const coder = screen.getByText('CODER').closest('li, a, button')!;
    expect(coder.querySelector('[data-project-label]')).toBeNull();
  });

  it('shows one slug of two projects as two rows', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount({
      configs: {
        [APP]: configView({ repository: APP, specialists: [own('tester', 'Тестер app')] }),
        [LIB]: configView({ repository: LIB, specialists: [own('tester', 'Тестер lib')] }),
      },
    });
    await screen.findByText('Тестер app');
    expect(screen.getByText('Тестер lib')).toBeTruthy();
  });

  it('shows the error of a project and the rows of the others', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount({
      configs: {
        [APP]: configView({ repository: APP, specialists: [own('tester', 'Тестер app')] }),
        [LIB]: new Error('no such directory'),
      },
    });
    await screen.findByText('Тестер app');
    expect(screen.getByText('lib: no such directory')).toBeTruthy();
  });

  it('opens the address of a row with the project', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    fireEvent.click(await screen.findByText('Доки lib'));
    await waitFor(() => expect(window.location.hash).toBe('#specialists/docs?project=lib'));
  });

  it('narrows the list by the filter «Project»', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    await screen.findByText('Тестер app');
    fireEvent.click(await screen.findByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    await waitFor(() => expect(screen.queryByText('Тестер app')).toBeNull());
    expect(screen.getByText('Доки lib')).toBeTruthy();
  });

  it('asks for the project before a new specialist', async () => {
    modeOn();
    window.location.hash = '#specialists';
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /New specialist/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: /lib/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(window.location.hash).toBe('#specialists/new?project=lib'));
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

  it('lists the shared pipelines once and the project ones with their project', async () => {
    modeOn();
    window.location.hash = '#pipelines';
    mount({
      configs: {
        [APP]: configView({
          repository: APP,
          specialists: [shared('coder')],
          pipelines: [pipeline('feature', 'project', 'Фича app') as never],
        }),
        [LIB]: configView({
          repository: LIB,
          specialists: [shared('coder')],
          pipelines: [
            pipeline('feature', 'project', 'Фича lib') as never,
            pipeline('explore', 'global', 'Разведка') as never,
          ],
        }),
      },
    });
    await screen.findByText('Фича app');
    expect(screen.getByText('Фича lib')).toBeTruthy();
    expect(screen.getAllByText('Разведка')).toHaveLength(1);
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
