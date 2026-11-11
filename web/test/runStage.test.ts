import { describe, expect, it } from 'vitest';

import { runStage } from '../src/features/runs/list/runStage.ts';
import { groupRow, runView, systemRow } from './fixtures.ts';

const name = (kind: string) => `sys:${kind}`;
const stage = (run: ReturnType<typeof runView>) => runStage(run, name);

describe('runStage', () => {
  it('names the step of a single group', () => {
    expect(stage(runView({ groups: [groupRow()] }))).toEqual({
      first: 'Кодер',
      rest: 0,
      all: ['Кодер'],
    });
  });

  it('names a running split', () => {
    const run = runView({ groups: [], system: [systemRow('split')] });
    expect(stage(run)?.first).toBe('sys:split');
  });

  it('puts the waiting entry first in a run that needs a human', () => {
    const run = runView({
      state: 'needs_human',
      groups: [
        groupRow({ slug: 'ui', status: 'running' }),
        groupRow({ slug: 'api', status: 'needs_human', stepName: 'Ревьюер' }),
      ],
    });
    expect(stage(run)).toEqual({ first: 'Ревьюер', rest: 1, all: ['Ревьюер', 'Кодер'] });
  });

  it('puts a running group before a waiting one', () => {
    const run = runView({
      groups: [
        groupRow({ slug: 'api', status: 'waiting', stepName: 'Кодер' }),
        groupRow({ slug: 'ui', status: 'running', stepName: 'Ревьюер' }),
      ],
    });
    expect(stage(run)).toMatchObject({ first: 'Ревьюер', rest: 1 });
  });

  it('counts groups on one step once', () => {
    const run = runView({
      groups: ['a', 'b', 'c'].map((slug) => groupRow({ slug })),
    });
    expect(stage(run)).toMatchObject({ first: 'Кодер', rest: 0 });
  });

  it('shows a stage of a paused run', () => {
    const run = runView({ state: 'paused', groups: [groupRow({ stepName: 'Ревьюер' })] });
    expect(stage(run)?.first).toBe('Ревьюер');
  });

  it.each(['finished', 'failed', 'cancelled', 'queued'] as const)(
    'has no stage when %s',
    (state) => {
      expect(stage(runView({ state, groups: [groupRow()] }))).toBeNull();
    },
  );

  it('has no stage while every group is merging', () => {
    const run = runView({ groups: [groupRow({ status: 'merging' })] });
    expect(stage(run)).toBeNull();
  });

  it('names a pipeline action by its title', () => {
    const run = runView({
      groups: [],
      system: [systemRow('action', { title: 'Деплой' })],
    });
    expect(stage(run)?.first).toBe('Деплой');
  });

  it('skips a merged system step', () => {
    const run = runView({
      groups: [groupRow()],
      system: [systemRow('split', { status: 'done' })],
    });
    expect(stage(run)).toMatchObject({ first: 'Кодер', rest: 0 });
  });
});
