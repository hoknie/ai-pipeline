// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TagsProvider } from '../src/tags.tsx';
import { RunList } from '../src/components/runs/RunList.tsx';
import {
  activeFilters,
  filterCounts,
  filterRuns,
  navRunCounts,
  runsOf,
  type RunFilter,
} from '../src/components/runs/runFilter.ts';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';
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

describe('search by task number', () => {
  const numbered = [7, 17, 70].map((number) =>
    runView({ id: `n${number}`, title: 'Задача', number }),
  );

  it('finds the run by #N exactly, not the numbers that contain it', () => {
    expect(filterRuns(numbered, '#7', 'all').map((run) => run.id)).toEqual(['n7']);
    expect(filterRuns(numbered, '#17', 'all').map((run) => run.id)).toEqual(['n17']);
    expect(filterRuns(numbered, '#8', 'all')).toEqual([]);
  });

  it('keeps the text search for other queries', () => {
    expect(filterRuns(numbered, 'задача', 'all')).toHaveLength(3);
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
  it('searches without regard to case in the title, the name, the workflow, the id and the groups', () => {
    expect(filterRuns(runs, 'жДущИй', 'all').map((run) => run.id)).toEqual(['w']);
    expect(filterRuns(runs, 'FEATURE-login', 'all').map((run) => run.id)).toEqual(['a']);
    expect(filterRuns(runs, 'регистр', 'all').map((run) => run.id)).toEqual(['g']);
    expect(filterRuns(runs, 'feature', 'all')).toHaveLength(runs.length);
    expect(filterRuns(runs, '  ', 'all')).toHaveLength(runs.length);
    expect(filterRuns(runs, 'run1', 'all')).toHaveLength(0);
  });

  it('filters by phase and counts each filter; a cancelled run counts as finished', () => {
    expect(filterRuns(runs, '', 'waiting').map((run) => run.id)).toEqual(['w']);
    expect(filterRuns(runs, '', 'active').map((run) => run.id)).toEqual(['a', 'g']);
    expect(filterRuns(runs, '', 'done').map((run) => run.id)).toEqual(['f', 'c']);
    expect(filterCounts(runs)).toEqual({ all: 5, waiting: 1, active: 2, done: 2 });
  });

  it('counts a failed run as done', () => {
    const failed = runView({ id: 'x', state: 'failed', finished: true });
    expect(filterRuns([failed], '', 'done').map((run) => run.id)).toEqual(['x']);
    expect(filterRuns([failed], '', 'active')).toEqual([]);
  });

  it('counts a run waiting in the queue as active, not as done', () => {
    const queued = runView({ id: 'q', state: 'queued', finished: true, queueItem: 'q1' });
    const all = [...runs, queued];
    expect(filterRuns(all, '', 'active').map((run) => run.id)).toEqual(['a', 'g', 'q']);
    expect(filterRuns(all, '', 'done').map((run) => run.id)).toEqual(['f', 'c']);
    expect(filterCounts(all)).toEqual({ all: 6, waiting: 1, active: 3, done: 2 });
    expect(navRunCounts(all)).toEqual(navRunCounts(runs));
  });

  it('keeps the order of the runs and combines the query with the filter', () => {
    expect(filterRuns(runs, 'готовый', 'active')).toEqual([]);
    expect(filterRuns(runs, 'о', 'all').map((run) => run.id)).toEqual(['w', 'a', 'f', 'c', 'g']);
  });

  it('keeps only the runs of one repository, or every run for null', () => {
    const mixed = [
      runView({ id: 'a1', repository: '/work/app' }),
      runView({ id: 'l1', repository: '/work/lib', state: 'needs_human' }),
      runView({ id: 'a2', repository: '/work/app', finished: true, state: 'finished' }),
    ];
    expect(filterRuns(mixed, '', 'all', '/work/app').map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(filterRuns(mixed, '', 'all', null)).toHaveLength(3);
    expect(filterRuns(mixed, '', 'waiting', '/work/app')).toEqual([]);
    expect(filterCounts(runsOf(mixed, '/work/app'))).toMatchObject({ all: 2, done: 1 });
  });
});

function Harness({ initial = 'all' as RunFilter }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RunFilter>(initial);
  return (
    <RunList
      runs={runs}
      selectedRun={null}
      selectedGroup={null}
      now={0}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      onSelect={() => undefined}
      scope="repository"
      onScope={() => undefined}
      repository={null}
      tagIds={[]}
      onTagIds={() => undefined}
    />
  );
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

  it('shows only the runs waiting for an answer', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Waiting 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Waiting 1' }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    expect(screen.getByText('Ждущий Запуск')).toBeTruthy();
  });

  it('says that nothing is found and resets the search and the filter', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'Finished 2' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'нет такого' } });
    expect(screen.getByText('Nothing found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByText('Nothing found')).toBeNull();
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(5);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });

  it('puts the cancelled run into «Finished»', () => {
    render(<Harness initial="done" />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Готовый')).toBeTruthy();
    expect(within(items[1]!).getByText('Отменённый')).toBeTruthy();
  });
});

describe('filter by tags', () => {
  const auth = { id: 'ta', name: 'auth', color: 'red' as const, task: null };
  const v2 = { id: 'tv', name: 'v2', color: 'blue' as const, task: null };
  const catalog = new Map([auth, v2].map((tag) => [tag.id, tag]));
  const tagged = [
    runView({ id: 'A', title: 'Веб-панель', tags: [auth], state: 'needs_human' }),
    runView({ id: 'B', title: 'Другое', tags: [v2] }),
    runView({ id: 'C', title: 'Без тегов' }),
    runView({ id: 'D', title: 'Ещё', tags: [auth], state: 'finished', finished: true }),
  ];
  const ids = (list: typeof tagged) => list.map((run) => run.id);

  it('keeps the runs with any of the chosen tags', () => {
    expect(ids(filterRuns(tagged, '', 'all', null, ['ta', 'tv'], catalog))).toEqual([
      'A',
      'B',
      'D',
    ]);
    expect(ids(filterRuns(tagged, '', 'all', null, [], catalog))).toHaveLength(4);
  });

  it('combines with the status filter', () => {
    expect(ids(filterRuns(tagged, '', 'waiting', null, ['ta'], catalog))).toEqual(['A']);
  });

  it('searches the names of the tags of a run', () => {
    expect(ids(filterRuns(tagged, 'Auth', 'all', null, [], catalog))).toEqual(['A', 'D']);
  });

  it('counts the status filter over the runs with the tags', () => {
    expect(filterCounts(tagged, ['ta'])).toEqual({ all: 2, waiting: 1, active: 0, done: 1 });
  });

  it('resets the tags together with the search', () => {
    const onTagIds = vi.fn();
    render(
      <RunList
        runs={[]}
        selectedRun={null}
        selectedGroup={null}
        now={0}
        query=""
        onQuery={() => undefined}
        filter="all"
        onFilter={() => undefined}
        onSelect={() => undefined}
        scope="repository"
        onScope={() => undefined}
        repository={null}
        tagIds={['gone']}
        onTagIds={onTagIds}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onTagIds).toHaveBeenCalledWith([]);
  });
});

describe('activeFilters', () => {
  it('counts a search, a status other than «all» and every chosen tag', () => {
    expect(activeFilters('', 'all', [])).toBe(0);
    expect(activeFilters('  ', 'all', [])).toBe(0);
    expect(activeFilters('json', 'all', [])).toBe(1);
    expect(activeFilters('', 'waiting', [])).toBe(1);
    expect(activeFilters('', 'all', ['ta', 'tv'])).toBe(2);
    expect(activeFilters('x', 'done', ['ta'])).toBe(3);
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
    const [tagIds, setTagIds] = useState<string[]>([]);
    const shown = filterRuns(rows, '', 'all', null, tagIds, new Map([[linked.id, linked]]));
    return (
      <TagsProvider tags={[linked]}>
        <RunList
          runs={shown}
          selectedRun={null}
          selectedGroup={null}
          now={0}
          query=""
          onQuery={() => undefined}
          filter="all"
          onFilter={() => undefined}
          onSelect={() => undefined}
          scope="repository"
          onScope={() => undefined}
          repository={null}
          tagIds={tagIds}
          onTagIds={setTagIds}
        />
      </TagsProvider>
    );
  }

  it('offers, applies and removes it like an ordinary tag', () => {
    render(<Filtered />);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
    fireEvent.click(screen.getByRole('combobox', { name: 'Tags' }));
    fireEvent.click(screen.getByRole('option', { name: /cards-half-width/ }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag cards-half-width' }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
  });
});

describe('search by the name of the pipeline', () => {
  it('finds a run by the name and by the id of its pipeline', () => {
    const runs = [
      runView({ id: 'a', title: 'Первый', workflow: 'feature', workflowName: 'Новая функция' }),
      runView({ id: 'b', title: 'Второй', workflow: 'fix', workflowName: 'Исправление' }),
    ];
    expect(filterRuns(runs, 'функци', 'all').map((run) => run.id)).toEqual(['a']);
    expect(filterRuns(runs, 'fix', 'all').map((run) => run.id)).toEqual(['b']);
  });
});
