import { describe, expect, it } from 'vitest';

import {
  type ObserverSettings,
  defaultObserverSettings,
  planRepairs,
  repairAdmitted,
  repairIncidents,
  personQuestions,
  waitsForPerson,
} from '../../../src/feature/observers/types/index.ts';
import { checkObserverSettings } from '../../../src/feature/observers/services/settings-check.ts';
import { repairTask, transition } from '../../../src/feature/runs/machine/index.ts';
import type { Incident, RunState } from '../../../src/feature/runs/types/index.ts';

import { finish, run, step } from '../runs/helpers.ts';

function settings(patch: Partial<ObserverSettings> = {}): ObserverSettings {
  return {
    ...defaultObserverSettings(),
    enabled: true,
    projects: [{ repository: '/repo', maxWorkers: null }],
    ...patch,
  };
}

/** A run whose first group timed out. */
function failedRun(id: string, at = 1000, repository = '/repo'): RunState {
  const state = run(1, { id, now: at });
  state.run.repository = repository;
  step(state);
  transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, at + 100);
  return state;
}

function incidentOf(state: RunState): Incident {
  const [incident] = repairIncidents(state);
  if (!incident) throw new Error('no incident');
  return incident;
}

describe('defaults', () => {
  it('start with observers off', () => {
    expect(defaultObserverSettings()).toEqual({
      enabled: false,
      workers: 1,
      maxRepairs: 5,
      projects: [],
      specialist: {},
    });
  });
});

describe('incidents of a task', () => {
  it('lists failed groups and questions, with their kind', () => {
    const state = failedRun('run000000001');
    expect(repairIncidents(state)).toEqual([
      expect.objectContaining({ kind: 'failed', group: 'gruppa-1' }),
    ]);
    const asking = run(1);
    step(asking);
    finish(asking, 'needs_human', { questions: [{ text: 'Что делать?' }] });
    expect(repairIncidents(asking)).toEqual([
      expect.objectContaining({ kind: 'question', group: 'gruppa-1' }),
    ]);
  });

  it('skips cancelled and usage-limit states', () => {
    const cancelled = run(1);
    step(cancelled);
    transition(cancelled, { kind: 'cancel', group: null }, 3000);
    expect(repairIncidents(cancelled)).toEqual([]);
    const limited = failedRun('run000000002');
    limited.groups[0]!.attempts[0]!.reason = {
      kind: 'usage_limit',
      resetsAt: 9_999_999,
    } as never;
    expect(repairIncidents(limited)).toEqual([]);
  });

  it.each(['request', 'review'] as const)(
    'never offers a question for a person only (%s)',
    (humanOnly) => {
      const state = run(1);
      step(state);
      finish(state, 'needs_human', { questions: [{ text: 'Пароль?' }] });
      state.groups[0]!.humanOnly = humanOnly;
      expect(repairIncidents(state)).toEqual([]);
      expect(waitsForPerson(state.groups[0]!)).toBe(true);
      expect(personQuestions(state)).toHaveLength(1);
    },
  );

  it('does not treat a cancelled group with a saved mark as waiting for a person', () => {
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { questions: [{ text: 'Пароль?' }] });
    state.groups[0]!.humanOnly = 'request';
    transition(state, { kind: 'cancel', group: 'gruppa-1' }, 3000);
    expect(waitsForPerson(state.groups[0]!)).toBe(false);
    expect(personQuestions(state)).toEqual([]);
  });

  it('puts the person-only rule and the mark into the task of the observer', () => {
    const state = run(2);
    step(state);
    finish(state, 'needs_human', { questions: [{ text: 'Принять?' }] });
    state.groups[0]!.humanOnly = 'review';
    const text = repairTask(state, { key: 'k', kind: 'failed', group: 'gruppa-2', detail: '' });
    expect(text).toContain('is never yours');
    expect(text).toContain('gruppa-1 (');
    expect(text).toContain('needs_human, question for a person only');
  });

  it('skips the keys already taken', () => {
    const state = failedRun('run000000001');
    state.run.repair.taken.push(incidentOf(state).key);
    expect(repairIncidents(state)).toEqual([]);
  });
});

describe('admission', () => {
  it('needs observers on, a connected project, no ban, no hold and repairs left', () => {
    const state = failedRun('run000000001');
    expect(repairAdmitted(state, settings())).toBe(true);
    expect(repairAdmitted(state, settings({ enabled: false }))).toBe(false);
    expect(repairAdmitted(state, settings({ projects: [] }))).toBe(false);
    state.run.repair.repairs = 5;
    expect(repairAdmitted(state, settings())).toBe(false);
    expect(repairAdmitted(state, settings({ maxRepairs: 6 }))).toBe(true);
    state.run.repair.repairs = 0;
    state.run.repair.allowed = false;
    expect(repairAdmitted(state, settings())).toBe(false);
    state.run.repair.allowed = true;
    state.run.hold = 'paused';
    expect(repairAdmitted(state, settings())).toBe(false);
  });
});

describe('worker pool of observers', () => {
  const none = new Map<string, number>();

  it('takes the oldest incidents first, up to workers', () => {
    const newer = failedRun('run000000001', 5000);
    const older = failedRun('run000000002', 1000);
    const third = failedRun('run000000003', 3000);
    const plan = planRepairs(settings({ workers: 2 }), [newer, older, third], none);
    expect(plan.map((start) => start.state.run.id)).toEqual(['run000000002', 'run000000003']);
  });

  it('counts running repairs against workers and maxWorkers', () => {
    const busy = failedRun('run000000001');
    busy.run.repair.incident = incidentOf(busy);
    const other = failedRun('run000000002');
    expect(planRepairs(settings(), [busy, other], none)).toEqual([]);
    expect(planRepairs(settings({ workers: 2 }), [busy, other], none)).toHaveLength(1);
    const limited = settings({
      workers: 5,
      projects: [{ repository: '/repo', maxWorkers: 1 }],
    });
    expect(planRepairs(limited, [busy, other], none)).toEqual([]);
  });

  it('starts nothing when off, held by a limit of the runtime, or a task has a repair', () => {
    const state = failedRun('run000000001');
    expect(planRepairs(settings({ enabled: false }), [state], none)).toEqual([]);
    expect(planRepairs(settings(), [state], new Map([['claude', 9]]))).toEqual([]);
    expect(
      planRepairs(
        settings({ specialist: { runtime: 'opencode' } }),
        [state],
        new Map([['claude', 9]]),
      ),
    ).toHaveLength(1);
    state.run.repair.incident = incidentOf(state);
    expect(planRepairs(settings(), [state], none)).toEqual([]);
  });

  it('stops giving a task to observers after maxRepairs', () => {
    const state = failedRun('run000000001');
    state.run.repair.repairs = 5;
    expect(planRepairs(settings(), [state], none)).toEqual([]);
  });
});

describe('task of the observer', () => {
  it('names the incident, the groups and the tools', () => {
    const state = failedRun('run000000001');
    const text = repairTask(state, incidentOf(state));
    expect(text).toContain('swarm_repair_retry');
    expect(text).toContain('gruppa-1');
    expect(text).toContain('failed');
  });

  it('adds the conflicts of a delivery', () => {
    const state = failedRun('run000000001');
    const incident: Incident = { key: 'k', kind: 'delivery', group: 'gruppa-1', detail: 'x' };
    const text = repairTask(state, incident, { conflicts: ['src/a.ts'] });
    expect(text).toContain('<<<<<<<');
    expect(text).toContain('- src/a.ts');
  });
});

describe('settings check', () => {
  it('rejects the removed answerHumanOnly key', () => {
    const check = checkObserverSettings({ answerHumanOnly: true }, settings(), new Set());
    expect(check.settings).toBeNull();
    expect(check.errors).toContainEqual({ path: 'answerHumanOnly', message: 'unknown key' });
  });
});
