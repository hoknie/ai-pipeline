// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunList } from '../src/components/runs/RunList.tsx';
import {
  filterCounts,
  filterRuns,
  navRunCounts,
  runsOf,
  type RunFilter,
} from '../src/components/runs/runFilter.ts';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';
import { groupRow, runView } from './fixtures.ts';

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
    />
  );
}

describe('run list', () => {
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
