// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TagsProvider } from '../src/tags.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import {
  activeFilters,
  EMPTY_FILTERS,
  filterRuns,
  navRunCounts,
  optionCounts,
  RUN_STATES,
  runSpecialists,
  type RunFilterState,
} from '../src/components/runs/runFilter.ts';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';
import type { RunView } from '../src/types.ts';
import { groupRow, runView, tagView } from './fixtures.ts';

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

const runs = [
  runView({ id: 'w', title: 'Ждущий Запуск', state: 'needs_human', waiting: 1 }),
  runView({ id: 'a', title: 'Активный', name: 'feature-login' }),
  runView({ id: 'f', title: 'Готовый', state: 'finished', finished: true }),
  runView({ id: 'c', title: 'Отменённый', state: 'cancelled', finished: true }),
  runView({
    id: 'g',
    title: 'С группами',
    groups: [groupRow({ title: 'Регистрация' }), groupRow({ slug: 'x', title: 'Выход' })],
  }),
];

const only = (patch: Partial<RunFilterState>): RunFilterState => ({ ...EMPTY_FILTERS, ...patch });
const ids = (list: { id: string }[]) => list.map((run) => run.id);
const find = (
  list: ReturnType<typeof runView>[],
  query: string,
  state: RunFilterState = EMPTY_FILTERS,
  scope: 'repository' | 'all' = 'all',
  repository: string | null = null,
  catalog: Map<string, never> | Map<string, ReturnType<typeof tagView>> = new Map(),
) => filterRuns(list, query, state, scope, repository, catalog as never);

describe('search by task number', () => {
  const numbered = [7, 17, 70].map((number) =>
    runView({ id: `n${number}`, title: 'Задача', number }),
  );

  it('finds the run by #N exactly, not the numbers that contain it', () => {
    expect(ids(find(numbered, '#7'))).toEqual(['n7']);
    expect(ids(find(numbered, '#17'))).toEqual(['n17']);
    expect(find(numbered, '#8')).toEqual([]);
  });

  it('keeps the text search for other queries', () => {
    expect(find(numbered, 'задача')).toHaveLength(3);
  });
});

describe('navRunCounts', () => {
  it('counts the unfinished runs and those waiting for an answer', () => {
    expect(navRunCounts(runs)).toEqual({ working: 3, waiting: 1 });
  });

  it('gives zeros for no runs', () => {
    expect(navRunCounts([])).toEqual({ working: 0, waiting: 0 });
  });
});

describe('filterRuns', () => {
  it('searches without regard to case in the title, the name, the pipeline, the id and the groups', () => {
    expect(ids(find(runs, 'жДущИй'))).toEqual(['w']);
    expect(ids(find(runs, 'FEATURE-login'))).toEqual(['a']);
    expect(ids(find(runs, 'регистр'))).toEqual(['g']);
    expect(find(runs, 'feature')).toHaveLength(runs.length);
    expect(find(runs, '  ')).toHaveLength(runs.length);
    expect(find(runs, 'run1')).toHaveLength(0);
  });

  it('offers the state repair and filters by it', () => {
    expect(RUN_STATES).toContain('repair');
    const mending = runView({ id: 'r', state: 'repair' as string as RunView['state'] });
    expect(ids(find([...runs, mending], '', only({ states: ['repair'] })))).toEqual(['r']);
  });

  it('filters by one or several of the eight states', () => {
    expect(ids(find(runs, '', only({ states: ['needs_human'] })))).toEqual(['w']);
    expect(ids(find(runs, '', only({ states: ['active'] })))).toEqual(['a', 'g']);
    expect(ids(find(runs, '', only({ states: ['finished', 'cancelled'] })))).toEqual(['f', 'c']);
    expect(ids(find(runs, '', only({ states: ['failed'] })))).toEqual([]);
  });

  it('shows a run waiting in the queue only under «Queued»', () => {
    const queued = runView({ id: 'q', state: 'queued', finished: true, queueItem: 'q1' });
    const all = [...runs, queued];
    expect(ids(find(all, '', only({ states: ['queued'] })))).toEqual(['q']);
    expect(ids(find(all, '', only({ states: ['active', 'finished'] })))).toEqual(['a', 'f', 'g']);
    expect(navRunCounts(all)).toEqual(navRunCounts(runs));
  });

  it('keeps frozen and paused runs apart', () => {
    const held = [
      runView({ id: 'fr', state: 'frozen', hold: 'frozen' }),
      runView({ id: 'pa', state: 'paused', hold: 'paused' }),
    ];
    expect(ids(find(held, '', only({ states: ['frozen'] })))).toEqual(['fr']);
    expect(ids(find(held, '', only({ states: ['paused'] })))).toEqual(['pa']);
  });

  it('keeps the order of the runs and combines the query with the filter', () => {
    expect(find(runs, 'готовый', only({ states: ['active'] }))).toEqual([]);
    expect(ids(find(runs, 'о'))).toEqual(['w', 'a', 'f', 'c', 'g']);
  });

  it('keeps only the runs of one repository in the scope «repository»', () => {
    const mixed = [
      runView({ id: 'a1', repository: '/work/app' }),
      runView({ id: 'l1', repository: '/work/lib', state: 'needs_human' }),
      runView({ id: 'a2', repository: '/work/app', finished: true, state: 'finished' }),
    ];
    expect(ids(find(mixed, '', EMPTY_FILTERS, 'repository', '/work/app'))).toEqual(['a1', 'a2']);
    expect(find(mixed, '', EMPTY_FILTERS, 'all', '/work/app')).toHaveLength(3);
    expect(find(mixed, '', only({ states: ['needs_human'] }), 'repository', '/work/app')).toEqual(
      [],
    );
  });

  it('filters by repository only when the runs of every repository are shown', () => {
    const mixed = [
      runView({ id: 'a1', repository: '/work/app' }),
      runView({ id: 'l1', repository: '/work/lib' }),
    ];
    const state = only({ repositories: ['/work/lib'] });
    expect(ids(find(mixed, '', state, 'all'))).toEqual(['l1']);
    expect(ids(find(mixed, '', state, 'repository', '/work/app'))).toEqual(['a1']);
  });

  it('filters by pipeline and by specialist, any of the choices and all the filters together', () => {
    const steps = (...slugs: string[]) =>
      slugs.map((specialist, index) => ({
        id: `s${index}`,
        specialist,
        name: specialist,
        skipped: false,
        state: 'upcoming' as const,
      }));
    const rows = [
      runView({ id: 'f1', pipeline: 'feature', steps: steps('planner', 'coder') }),
      runView({ id: 'f2', pipeline: 'feature', steps: steps('coder') }),
      runView({ id: 'x1', pipeline: 'fix', steps: steps('debugger') }),
    ];
    expect(ids(find(rows, '', only({ pipelines: ['fix'] })))).toEqual(['x1']);
    expect(ids(find(rows, '', only({ pipelines: ['fix', 'feature'] })))).toEqual([
      'f1',
      'f2',
      'x1',
    ]);
    expect(ids(find(rows, '', only({ specialists: ['coder'] })))).toEqual(['f1', 'f2']);
    expect(ids(find(rows, '', only({ specialists: ['planner', 'debugger'] })))).toEqual([
      'f1',
      'x1',
    ]);
    expect(ids(find(rows, '', only({ pipelines: ['feature'], specialists: ['planner'] })))).toEqual(
      ['f1'],
    );
    // the search covers the slug of the pipeline and the specialists
    expect(ids(find(rows, 'debugger'))).toEqual(['x1']);
  });

  it('does not count the specialists of skipped steps', () => {
    const run = runView({
      steps: [
        { id: 'a', specialist: 'planner', name: 'a', skipped: true, state: 'upcoming' },
        { id: 'b', specialist: 'coder', name: 'b', skipped: false, state: 'upcoming' },
      ],
    });
    expect(runSpecialists(run)).toContain('coder');
    expect(runSpecialists(run)).not.toContain('planner');
  });

  it('counts the options by the other filters (faceted)', () => {
    const rows = [
      runView({ id: 'a', pipeline: 'feature', state: 'active' }),
      runView({ id: 'b', pipeline: 'feature', state: 'finished', finished: true }),
      runView({ id: 'c', pipeline: 'fix', state: 'finished', finished: true }),
    ];
    const state = only({ pipelines: ['fix'] });
    const states = optionCounts(rows, '', state, 'all', null, new Map(), 'states');
    expect(states.get('finished')).toBe(1);
    expect(states.get('active')).toBeUndefined();
    const pipelines = optionCounts(rows, '', state, 'all', null, new Map(), 'pipelines');
    expect(pipelines.get('feature')).toBe(2);
    expect(pipelines.get('fix')).toBe(1);
    const searched = optionCounts(rows, 'нет', EMPTY_FILTERS, 'all', null, new Map(), 'states');
    expect(searched.size).toBe(0);
  });
});

function Harness({ initial = EMPTY_FILTERS }: { initial?: RunFilterState }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<RunFilterState>(initial);
  return (
    <RunList
      runs={runs}
      selectedRun={null}
      selectedGroup={null}
      now={0}
      query={query}
      onQuery={setQuery}
      filters={filters}
      onFilters={setFilters}
      onSelect={() => undefined}
      scope="repository"
      onScope={() => undefined}
      repository={null}
    />
  );
}

async function choose(filter: string, option: RegExp | string) {
  fireEvent.click(screen.getByRole('combobox', { name: filter }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('run list', () => {
  it('shows the task number of each run and finds a run by #N', () => {
    render(<Harness />);
    expect(screen.getAllByText('#1')).toHaveLength(runs.length);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search runs' }), {
      target: { value: '#1' },
    });
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(runs.length);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search runs' }), {
      target: { value: '#10' },
    });
    expect(screen.queryAllByRole('button', { expanded: false })).toHaveLength(0);
  });

  it('finds a run by its title', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search runs' }), {
      target: { value: 'готов' },
    });
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    expect(screen.getByText('Готовый')).toBeTruthy();
  });

  it('shows only the runs waiting for an answer, with the choice kept on the button', async () => {
    render(<Harness />);
    await choose('State', /Needs answer/);
    expect(screen.getAllByRole('button', { expanded: false, name: /./ })).toBeTruthy();
    expect(screen.getByText('Ждущий Запуск')).toBeTruthy();
    expect(screen.queryByText('Активный')).toBeNull();
    // the list stays open: another state can be added
    fireEvent.click(screen.getByRole('option', { name: /Cancelled/ }));
    expect(screen.getByText('Отменённый')).toBeTruthy();
  });

  it('says that nothing is found and resets the search and every filter', async () => {
    render(<Harness />);
    await choose('State', /Finished/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'нет такого' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByText('Nothing found')).toBeNull();
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(5);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });

  it('puts the cancelled run into «Cancelled» and keeps the order', () => {
    render(<Harness initial={only({ states: ['finished', 'cancelled'] })} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Готовый')).toBeTruthy();
    expect(within(items[1]!).getByText('Отменённый')).toBeTruthy();
  });
});

describe('filter by tags', () => {
  const auth = { id: 'ta', repository: '/repo', name: 'auth', color: 'red' as const, task: null };
  const v2 = { id: 'tv', repository: '/repo', name: 'v2', color: 'blue' as const, task: null };
  const catalog = new Map([auth, v2].map((tag) => [tag.id, tag]));
  const tagged = [
    runView({ id: 'A', title: 'Веб-панель', tags: [auth], state: 'needs_human' }),
    runView({ id: 'B', title: 'Другое', tags: [v2] }),
    runView({ id: 'C', title: 'Без тегов' }),
    runView({ id: 'D', title: 'Ещё', tags: [auth], state: 'finished', finished: true }),
  ];

  it('keeps the runs with any of the chosen tags', () => {
    expect(ids(find(tagged, '', only({ tagIds: ['ta', 'tv'] }), 'all', null, catalog))).toEqual([
      'A',
      'B',
      'D',
    ]);
    expect(find(tagged, '', EMPTY_FILTERS, 'all', null, catalog)).toHaveLength(4);
  });

  it('matches the runs of other repositories by the name of the tag, ignoring case', () => {
    const other = { id: 'tx', repository: '/lib', name: 'Auth', color: 'red' as const, task: null };
    const rows = [
      runView({ id: 'A', repository: '/repo', tags: [auth] }),
      runView({ id: 'X', repository: '/lib', tags: [other] }),
      runView({ id: 'Y', repository: '/lib', tags: [{ ...other, id: 'ty', name: 'v2' }] }),
    ];
    const state = only({ tagIds: ['ta'] });
    expect(ids(find(rows, '', state, 'all', null, catalog))).toEqual(['A', 'X']);
    expect(ids(find(rows, '', state, 'repository', '/repo', catalog))).toEqual(['A']);
    expect(optionCounts(rows, '', EMPTY_FILTERS, 'all', null, catalog, 'tagIds').get('ta')).toBe(2);
  });

  it('combines with the state filter', () => {
    const state = only({ tagIds: ['ta'], states: ['needs_human'] });
    expect(ids(find(tagged, '', state, 'all', null, catalog))).toEqual(['A']);
  });

  it('searches the names of the tags of a run', () => {
    expect(ids(find(tagged, 'Auth', EMPTY_FILTERS, 'all', null, catalog))).toEqual(['A', 'D']);
  });

  it('counts the states over the runs with the tags', () => {
    const counts = optionCounts(
      tagged,
      '',
      only({ tagIds: ['ta'] }),
      'all',
      null,
      catalog,
      'states',
    );
    expect(counts.get('needs_human')).toBe(1);
    expect(counts.get('finished')).toBe(1);
    expect(counts.get('active')).toBeUndefined();
  });

  it('resets the filters together with the search', () => {
    const onFilters = vi.fn();
    render(
      <RunList
        runs={[]}
        selectedRun={null}
        selectedGroup={null}
        now={0}
        query=""
        onQuery={() => undefined}
        filters={only({ tagIds: ['gone'] })}
        onFilters={onFilters}
        onSelect={() => undefined}
        scope="repository"
        onScope={() => undefined}
        repository={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onFilters).toHaveBeenCalledWith(EMPTY_FILTERS);
  });
});

describe('activeFilters', () => {
  it('counts a search and every chosen value', () => {
    expect(activeFilters('', EMPTY_FILTERS, 'all')).toBe(0);
    expect(activeFilters('  ', EMPTY_FILTERS, 'all')).toBe(0);
    expect(activeFilters('json', EMPTY_FILTERS, 'all')).toBe(1);
    expect(activeFilters('', only({ states: ['active'] }), 'all')).toBe(1);
    expect(activeFilters('', only({ tagIds: ['ta', 'tv'] }), 'all')).toBe(2);
    expect(
      activeFilters('x', only({ states: ['failed'], pipelines: ['fix'], tagIds: ['ta'] }), 'all'),
    ).toBe(4);
  });

  it('ignores the repository choice outside the «all repositories» scope', () => {
    expect(activeFilters('', only({ repositories: ['/a'] }), 'repository')).toBe(0);
    expect(activeFilters('', only({ repositories: ['/a'] }), 'all')).toBe(1);
  });
});

describe('filter by the tag of a linked task', () => {
  const linked = {
    ...tagView('cards-half-width', 'indigo', 'l1'),
    task: { run: 'run9', number: 115 },
  };
  const rows = [
    runView({ id: 'A', title: 'Первый', tags: [linked] }),
    runView({ id: 'B', title: 'Второй' }),
  ];

  function Filtered() {
    const [filters, setFilters] = useState<RunFilterState>(EMPTY_FILTERS);
    return (
      <TagsProvider tags={[linked]}>
        <RunList
          runs={rows}
          selectedRun={null}
          selectedGroup={null}
          now={0}
          query=""
          onQuery={() => undefined}
          filters={filters}
          onFilters={setFilters}
          onSelect={() => undefined}
          scope="repository"
          onScope={() => undefined}
          repository="/repo"
        />
      </TagsProvider>
    );
  }

  it('offers, applies and removes it like an ordinary tag, without chips in the column', async () => {
    render(<Filtered />);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
    fireEvent.click(screen.getByRole('combobox', { name: 'Tags' }));
    fireEvent.click(await screen.findByRole('option', { name: /cards-half-width/ }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    // the choice is a number on the button, not a chip with a remove button
    expect(screen.queryByRole('button', { name: 'Remove tag cards-half-width' })).toBeNull();
    expect(within(screen.getByRole('combobox', { name: 'Tags' })).getByText('1')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /cards-half-width/ }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
  });
});

describe('search by the name of the pipeline', () => {
  it('finds a run by the name and by the id of its pipeline', () => {
    const named = [
      runView({ id: 'a', title: 'Первый', pipeline: 'feature', pipelineName: 'Новая функция' }),
      runView({ id: 'b', title: 'Второй', pipeline: 'fix', pipelineName: 'Исправление' }),
    ];
    expect(ids(find(named, 'функци'))).toEqual(['a']);
    expect(ids(find(named, 'fix'))).toEqual(['b']);
  });
});

describe('repository filter', () => {
  it('is offered only for the runs of every repository, with the path under the name', async () => {
    const rows = [
      runView({ id: 'a', repository: '/work/app' }),
      runView({ id: 'l', repository: '/work/lib' }),
    ];
    const paths = new Map([['/work/lib', '~/lib']]);
    const props = {
      runs: rows,
      selectedRun: null,
      selectedGroup: null,
      now: 0,
      query: '',
      onQuery: () => undefined,
      filters: EMPTY_FILTERS,
      onFilters: () => undefined,
      onSelect: () => undefined,
      onScope: () => undefined,
      repository: '/work/app',
      repositoryPaths: paths,
    };
    const { rerender } = render(<RunList {...props} scope="repository" />);
    expect(screen.queryByRole('combobox', { name: 'Repository' })).toBeNull();
    rerender(<RunList {...props} scope="all" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Repository' }));
    expect(await screen.findByText('~/lib')).toBeTruthy();
    expect(screen.getByText('/work/app')).toBeTruthy();
  });
});
