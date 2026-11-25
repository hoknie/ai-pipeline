import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Attempt, RunState } from '../../../src/feature/runs/types/index.ts';
import { emptySignal } from '../../../src/feature/runs/types/index.ts';
import { LessonStorage, LessonsRepository } from '../../../src/feature/runs/repositories/index.ts';
import { RunLessons } from '../../../src/feature/runs/services/lessons/index.ts';
import { temporaryStorage, type Storage } from '../storage.ts';
import { run } from './helpers.ts';

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    seq: 1,
    stepId: 'code',
    stepIndex: 0,
    round: 1,
    specialist: 'coder',
    runtime: 'claude',
    model: 'sonnet',
    generation: null,
    status: 'finished',
    input: {
      prompt: 'do it',
      groupTitle: 'Group 1',
      stepId: 'code',
      specialistName: 'Coder',
      skills: [],
      previous: [],
      feedback: null,
      humanAnswer: null,
      decisions: [],
    },
    resumeSession: null,
    sessionId: null,
    report: { verdict: 'done', summary: 'done', feedback: null },
    reason: null,
    startedAt: 10,
    finishedAt: 20,
    usage: null,
    proposal: null,
    denials: [],
    outsideChanges: [],
    ...overrides,
  };
}

function finishedRun(id: string, number: number, attempts: Attempt[], finishedAt = 5000): RunState {
  const state = run(1, { id });
  state.run.number = number;
  state.run.finishedAt = finishedAt;
  state.groups[0]!.attempts.push(...attempts);
  return state;
}

function serviceOf(store: Storage, root: string, now: () => number): RunLessons {
  return new RunLessons({
    runs: new LessonsRepository(store.database),
    storage: new LessonStorage(root),
    now,
  });
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aip-lessons-'));
}

describe('RunLessons', () => {
  it('returns the typed signal of a specialist by repository, empty without finished runs', () => {
    const store = temporaryStorage();
    const lessons = serviceOf(store, tempRoot(), () => 9000);

    expect(lessons.signalOf('/repo', 'coder')).toEqual(emptySignal('coder'));

    store.runs.saveRun(
      finishedRun('first', 7, [attempt({ usage: { inputTokens: 3, outputTokens: 2 } })]),
    );
    const signal = lessons.signalOf('/repo', 'coder');
    expect(signal.attempts).toBe(1);
    expect(signal.verdicts.done).toBe(1);
    expect(signal.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    store.database.close();
  });

  it('summarises the objective signal of every specialist of a run', () => {
    const store = temporaryStorage();
    const first = finishedRun('first', 7, [
      attempt({
        denials: [{ tool: 'Bash', command: 'rm -rf build' }],
        outsideChanges: ['/base/a.ts'],
      }),
    ]);
    first.groups[0]!.delivery = {
      ...first.groups[0]!.delivery,
      state: 'apply_failed',
      reason: 'conflict',
      conflicts: ['a.ts'],
      finishedAt: 4000,
    };
    store.runs.saveRun(first);
    store.runs.saveRun(
      finishedRun('second', 8, [attempt({ seq: 2, denials: [{ tool: 'Bash', command: null }] })]),
    );

    const lessons = serviceOf(store, tempRoot(), () => 9000);
    const summary = lessons.summary(first);

    expect(summary.runId).toBe('first');
    expect(summary.repository).toBe('/repo');
    expect(summary.specialists).toHaveLength(1);
    const [coder] = summary.specialists;
    expect(coder).toMatchObject({
      specialist: 'coder',
      attempts: 2,
      denials: 2,
      outsideChanges: 1,
      deliveryFailures: 1,
      dropped: 0,
    });
    expect(coder!.lessons.map((lesson) => lesson.kind)).toEqual([
      'denial',
      'delivery',
      'outside_changes',
    ]);
    expect(coder!.block).toContain('Lessons from earlier runs');
    store.database.close();
  });

  it('gives no block to a specialist without lessons and leaves no file', () => {
    const store = temporaryStorage();
    store.runs.saveRun(finishedRun('clean', 1, [attempt()]));
    const root = tempRoot();
    const lessons = serviceOf(store, root, () => 1000);

    expect(lessons.block('/repo', 'coder')).toBeNull();
    expect(new LessonStorage(root).read('/repo', 'coder')).toBeNull();
    store.database.close();
  });

  it('hydrates the finished runs once and reloads them only when another run finishes', () => {
    const store = temporaryStorage();
    store.runs.saveRun(
      finishedRun('first', 7, [attempt({ denials: [{ tool: 'Bash', command: null }] })]),
    );
    const repository = new LessonsRepository(store.database);
    const hydrated = vi.spyOn(repository, 'finishedRuns');
    const lessons = new RunLessons({
      runs: repository,
      storage: new LessonStorage(tempRoot()),
      now: () => 1000,
    });

    lessons.block('/repo', 'coder');
    lessons.block('/repo', 'coder');
    expect(hydrated).toHaveBeenCalledTimes(1);

    store.runs.saveRun(
      finishedRun('second', 8, [attempt({ seq: 2, denials: [{ tool: 'Bash', command: null }] })]),
    );
    lessons.block('/repo', 'coder');
    expect(hydrated).toHaveBeenCalledTimes(2);
    store.database.close();
  });

  it('reloads the history when the delivery of a finished run changes', () => {
    const store = temporaryStorage();
    const state = finishedRun('first', 7, [attempt()]);
    store.runs.saveRun(state);
    const repository = new LessonsRepository(store.database);
    const hydrated = vi.spyOn(repository, 'finishedRuns');
    const root = tempRoot();
    const storage = new LessonStorage(root);
    const lessons = new RunLessons({ runs: repository, storage, now: () => 1000 });

    expect(lessons.block('/repo', 'coder')).toBeNull();
    expect(hydrated).toHaveBeenCalledTimes(1);

    // A delivery that fails after the run finished teaches the next attempt at once.
    state.groups[0]!.delivery = {
      ...state.groups[0]!.delivery,
      state: 'apply_failed',
      reason: 'conflict',
      conflicts: ['a.ts'],
      finishedAt: 4000,
    };
    store.runs.saveRun(state);
    expect(lessons.block('/repo', 'coder')!.text).toContain(
      'Applying the result of the group failed',
    );
    expect(hydrated).toHaveBeenCalledTimes(2);
    expect(storage.read('/repo', 'coder')).not.toBeNull();

    // The user merged it by hand: the lesson is withdrawn, and so is its file.
    state.groups[0]!.delivery = {
      ...state.groups[0]!.delivery,
      state: 'applied',
      reason: null,
      conflicts: [],
      manual: true,
      finishedAt: 4500,
    };
    store.runs.saveRun(state);
    expect(lessons.block('/repo', 'coder')).toBeNull();
    expect(hydrated).toHaveBeenCalledTimes(3);
    expect(storage.read('/repo', 'coder')).toBeNull();
    store.database.close();
  });

  it('bumps the version only when the text changes and keeps the date of the change', () => {
    const store = temporaryStorage();
    store.runs.saveRun(
      finishedRun('first', 7, [attempt({ denials: [{ tool: 'Bash', command: null }] })]),
    );
    const root = tempRoot();
    const storage = new LessonStorage(root);

    const firstBlock = serviceOf(store, root, () => 1000).block('/repo', 'coder');
    expect(firstBlock).not.toBeNull();
    const first = storage.read('/repo', 'coder');
    expect(first).toMatchObject({ version: 1, generatedAt: 1000 });
    expect(first!.text).toBe(firstBlock!.text);

    const again = serviceOf(store, root, () => 2000).block('/repo', 'coder');
    expect(again!.text).toBe(firstBlock!.text);
    expect(storage.read('/repo', 'coder')).toMatchObject({ version: 1, generatedAt: 1000 });

    store.runs.saveRun(
      finishedRun('second', 8, [attempt({ seq: 2, denials: [{ tool: 'Bash', command: null }] })]),
    );
    const changed = serviceOf(store, root, () => 3000).block('/repo', 'coder');
    expect(changed!.text).not.toBe(firstBlock!.text);
    expect(storage.read('/repo', 'coder')).toMatchObject({ version: 2, generatedAt: 3000 });
    store.database.close();
  });
});
