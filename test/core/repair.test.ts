import { describe, expect, it } from 'vitest';

import { findSpecialist } from '../../src/config/index.ts';
import {
  REPAIR_GROUP,
  freezeCandidate,
  problemKeys,
  dispatch,
  emptyQueue,
  finishedApartFromRepair,
  isRunFinished,
  occupiesSlot,
  planDispatch,
  repairIncidents,
  runPhase,
  transition,
  defaultObserverSettings,
  type Effect,
  type Incident,
  type RunState,
} from '../../src/core/index.ts';

import { CONFIG_TEXT, finish, run, runningAttempt, step } from './helpers.ts';

const SETTINGS = {
  ...defaultObserverSettings(),
  enabled: true,
  projects: [{ repository: '/repo', maxWorkers: null }],
};

function profile(state: RunState) {
  const found = findSpecialist(state.run.config, 'coder');
  if (!found) throw new Error('no coder');
  return found;
}

function failedRun(options: { configText?: string; groups?: number } = {}): RunState {
  const state = run(options.groups ?? 1, { configText: options.configText });
  state.run.config.delivery.auto = false;
  step(state);
  transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 1100);
  return state;
}

function incidentOf(state: RunState): Incident {
  const [incident] = repairIncidents(state, SETTINGS);
  if (!incident) throw new Error('no incident');
  return incident;
}

function startRepair(state: RunState): Incident {
  const incident = incidentOf(state);
  transition(state, { kind: 'repair_start', incident, specialist: profile(state) }, 2000);
  return incident;
}

function repairing(): { state: RunState; incident: Incident } {
  const state = failedRun();
  const incident = startRepair(state);
  dispatch([state], 2100);
  return { state, incident };
}

function repairExit(state: RunState, failure: unknown = null, now = 3000): Effect[] {
  const attempt = runningAttempt(state, REPAIR_GROUP);
  return transition(
    state,
    {
      kind: 'attempt_exited',
      group: REPAIR_GROUP,
      seq: attempt.seq,
      exit: { sessionId: 's', usage: null, failure: failure as never, outsideChanges: [] },
    },
    now,
  );
}

describe('run state with an incident under repair', () => {
  it('is not finished while the repair has no group yet', () => {
    const state = failedRun();
    expect(state.run.finishedAt).not.toBeNull();
    expect(isRunFinished(state)).toBe(true);
    startRepair(state);
    expect(state.repair).not.toBeNull();
    expect(state.run.finishedAt).toBeNull();
    expect(isRunFinished(state)).toBe(false);
    expect(finishedApartFromRepair(state)).toBe(true);
  });

  it('is not changed in outcome by the repair group', () => {
    const { state } = repairing();
    expect(state.groups.map((g) => g.slug)).toEqual(['gruppa-1']);
    expect(runPhase(state)).not.toBe('cancelled');
    const before = runPhase(failedRun());
    expect(before).toBe('failed');
    expect(runPhase(state)).toBe('active');
  });

  it('refuses a second repair, and one on a held run', () => {
    const { state, incident } = repairing();
    expect(() =>
      transition(state, { kind: 'repair_start', incident, specialist: profile(state) }, 2200),
    ).toThrow('already going');
    const paused = run(2);
    step(paused);
    transition(paused, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 1100);
    transition(paused, { kind: 'hold', hold: 'paused' }, 1500);
    expect(() =>
      transition(
        paused,
        { kind: 'repair_start', incident: incidentOf(paused), specialist: profile(paused) },
        2000,
      ),
    ).toThrow('observers do not take it');
  });
});

describe('end of a repair', () => {
  it('done: merges the group, releases the incident and counts the key as taken', () => {
    const { state, incident } = repairing();
    finish(state, 'done', { slug: REPAIR_GROUP, now: 3000 });
    expect(state.repair?.status).toBe('merged');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.specialist).toBeNull();
    expect(state.run.repair.taken).toEqual([incident.key]);
    expect(state.run.repair.repairs).toBe(1);
    expect(state.run.finishedAt).not.toBeNull();
    expect(repairIncidents(state, SETTINGS)).toEqual([]);
  });

  it.each(['rejected', 'needs_human'] as const)(
    '%s: the incident stays with a person',
    (verdict) => {
      const { state, incident } = repairing();
      finish(state, verdict, {
        slug: REPAIR_GROUP,
        now: 3000,
        ...(verdict === 'needs_human' ? { questions: [{ text: 'Не знаю' }] } : {}),
      });
      expect(state.repair?.status).toBe('failed');
      expect(state.repair?.reason).toContain(`observer reported ${verdict}`);
      expect(state.run.repair.incident).toBeNull();
      expect(state.run.repair.taken).toEqual([incident.key]);
      expect(state.run.repair.repairs).toBe(1);
    },
  );

  it('a crash releases the incident without marking it taken', () => {
    const { state } = repairing();
    repairExit(state, { kind: 'crash', message: 'boom' });
    expect(state.repair?.status).toBe('failed');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(state.run.repair.repairs).toBe(1);
  });

  it('a timeout releases the incident', () => {
    const { state } = repairing();
    transition(state, { kind: 'timed_out', group: REPAIR_GROUP, seq: 1 }, 3000);
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
  });
});

describe('cancelling the work of an observer', () => {
  it('cancels the repair with the task and writes the reason', () => {
    const { state } = repairing();
    const effects = transition(state, { kind: 'cancel', group: null, reason: 'не нужно' }, 3000);
    expect(state.repair?.status).toBe('cancelled');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.cancelReason).toBe('не нужно');
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'stop_attempt', group: REPAIR_GROUP }),
    );
  });

  it('forbidding observers stops the repair; allowing resets the count', () => {
    const { state } = repairing();
    transition(state, { kind: 'repair_allowed', allowed: false }, 3000);
    expect(state.run.repair.allowed).toBe(false);
    expect(state.run.repair.incident).toBeNull();
    expect(state.repair?.status).toBe('cancelled');
    state.run.repair.repairs = 4;
    state.run.repair.taken = ['x'];
    transition(state, { kind: 'repair_allowed', allowed: true }, 3100);
    expect(state.run.repair).toMatchObject({ allowed: true, repairs: 0, taken: [] });
  });
});

describe('pause during a repair', () => {
  it('cancels the repair and gives it back', () => {
    const { state } = repairing();
    const effects = transition(state, { kind: 'hold', hold: 'paused' }, 3000);
    expect(state.repair?.status).toBe('cancelled');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.repairs).toBe(0);
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'stop_attempt' }));
    expect(state.run.hold).toBe('paused');
  });
});

describe('repair is outside the limits of the places', () => {
  it('starts although swarm.max is used up and counts nothing', () => {
    const state = run(2, { max: 1 });
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 1100);
    transition(
      state,
      { kind: 'repair_start', incident: incidentOf(state), specialist: profile(state) },
      1200,
    );
    dispatch([state], 1300);
    expect(runningAttempt(state, REPAIR_GROUP)).toBeDefined();
    expect(runningAttempt(state, 'gruppa-2')).toBeDefined();
    expect(planDispatch([state], 1400).waits.size).toBe(0);
  });
});

describe('queue view of a task under repair', () => {
  it('treats a task whose work is finished as finished while the repair runs', () => {
    const { state } = repairing();
    expect(state.run.finishedAt).toBeNull();
    expect(occupiesSlot(state)).toBe(false);
    const queue = emptyQueue('/repo', 1);
    queue.runs.push(state.run.id);
    expect(freezeCandidate(queue, [state], null)).toBeNull();
  });

  it('keeps the keys of the problems when the repair has attempts', () => {
    const state = run(2);
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 1100);
    transition(state, { kind: 'cancel', group: 'gruppa-2' }, 1200);
    const before = problemKeys(state);
    expect(before.some((key) => key.includes('/cancelled/'))).toBe(true);
    startRepair(state);
    dispatch([state], 2100);
    finish(state, 'done', { slug: REPAIR_GROUP, now: 3000 });
    expect(state.repair?.attempts).toHaveLength(1);
    expect(problemKeys(state)).toEqual(before);
  });

  it('does not take a usage limit of the repair for a limit of the work', () => {
    const { state } = repairing();
    repairExit(state, { kind: 'usage_limit', resetsAt: 9_999_999 });
    expect(problemKeys(state).filter((key) => key.includes('usage_limit'))).toEqual([]);
    expect(state.run.repair.repairs).toBe(0);
  });
});

describe('repair of a delivery', () => {
  const applied = { kind: 'applied' as const, files: ['src/app.ts'], conflicts: [], commit: null };
  const refused = {
    kind: 'refused' as const,
    reason: 'the changes conflict with your working tree',
    files: ['src/app.ts'],
    conflict: true,
  };

  /** Two merged groups whose delivery was refused. */
  function refusedDelivery(configText = CONFIG_TEXT): RunState {
    const state = run(2, { configText });
    state.run.config.delivery.auto = false;
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      for (const g of state.groups)
        finish(state, 'done', { slug: g.slug, summary: `${g.title} ok` });
    }
    for (const g of state.groups) {
      transition(
        state,
        {
          kind: 'merge_finished',
          group: g.slug,
          outcome: { kind: 'merged', commit: `c-${g.slug}` },
        },
        5000,
      );
    }
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
    transition(state, { kind: 'delivery_finished', result: refused }, 6100);
    return state;
  }

  function startDeliveryRepair(state: RunState): Effect[] {
    const incident = repairIncidents(state, SETTINGS).find((item) => item.kind === 'delivery');
    if (!incident) throw new Error('no delivery incident');
    return transition(state, { kind: 'repair_start', incident, specialist: profile(state) }, 7000);
  }

  it('takes every group of the refused delivery and prepares the tree', () => {
    const state = refusedDelivery();
    expect(repairIncidents(state, SETTINGS).map((item) => item.kind)).toEqual([
      'delivery',
      'delivery',
    ]);
    const effects = startDeliveryRepair(state);
    expect(effects).toEqual([
      { kind: 'prepare_resolve', run: state.run.id, groups: ['gruppa-1', 'gruppa-2'], round: 1 },
    ]);
    expect(state.run.pendingDelivery).toMatchObject({
      repair: true,
      force: false,
      groups: ['gruppa-1', 'gruppa-2'],
    });
    expect(state.run.pendingDelivery?.message).toContain('Группа 1');
    expect(state.run.repair.incident).not.toBeNull();
    expect(state.run.finishedAt).toBeNull();
  });

  it('runs the repair group on the prepared tree and delivers after done', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(
      transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100),
    ).toEqual([]);
    expect(state.resolve).toBeNull();
    expect(state.repair?.task).toContain('- src/app.ts');
    dispatch([state], 7200);
    const effects = finish(state, 'done', { slug: REPAIR_GROUP, now: 7300 });
    expect(effects).toEqual([
      expect.objectContaining({
        kind: 'finish_resolve',
        groups: ['gruppa-1', 'gruppa-2'],
        conflicts: ['src/app.ts'],
      }),
    ]);
    expect(state.run.repair.incident).not.toBeNull();
    transition(state, { kind: 'delivery_finished', result: applied }, 7400);
    expect(state.groups.map((g) => g.delivery.state)).toEqual(['applied', 'applied']);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toHaveLength(2);
    expect(state.run.finishedAt).not.toBeNull();
  });

  it('delivers at once when the prepared tree has no conflicts', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    const effects = transition(state, { kind: 'resolve_prepared', conflicts: [] }, 7100);
    expect(effects).toEqual([expect.objectContaining({ kind: 'finish_resolve' })]);
    expect(state.repair).toBeNull();
    transition(state, { kind: 'delivery_finished', result: applied }, 7200);
    expect(state.run.repair.incident).toBeNull();
  });

  it('gives no resolver rounds: a repeated refusal stays apply_failed and is not taken again', () => {
    const state = refusedDelivery();
    state.run.config.delivery.resolver = 'coder';
    state.run.config.delivery.resolverRounds = 3;
    startDeliveryRepair(state);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
    dispatch([state], 7200);
    finish(state, 'done', { slug: REPAIR_GROUP, now: 7300 });
    const effects = transition(state, { kind: 'delivery_finished', result: refused }, 7400);
    expect(effects).toEqual([]);
    expect(state.groups.map((g) => g.delivery.state)).toEqual(['apply_failed', 'apply_failed']);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(repairIncidents(state, SETTINGS)).toEqual([]);
  });

  it('a crash of the agent ends the delivery as apply_failed', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
    dispatch([state], 7200);
    repairExit(state, { kind: 'crash', message: 'boom' }, 7300);
    expect(state.groups.map((g) => g.delivery.state)).toEqual(['apply_failed', 'apply_failed']);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.repair?.status).toBe('failed');
  });

  it('a report other than done ends the delivery repair', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
    dispatch([state], 7200);
    finish(state, 'rejected', { slug: REPAIR_GROUP, now: 7300 });
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.groups[0]?.delivery.state).toBe('apply_failed');
  });

  it('is not resumed after a restart: the incident is taken again', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
    dispatch([state], 7200);
    transition(state, { kind: 'interrupted' }, 8000);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(state.groups[0]?.delivery.state).toBe('apply_failed');
    expect(repairIncidents(state, SETTINGS)).toHaveLength(2);
  });

  it('cancelling the task during preparation drops the delivery', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'cancel', group: null, reason: 'стоп' }, 7100);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
  });

  it('refuses a retry of the repair group by a person', () => {
    const { state } = repairing();
    finish(state, 'rejected', { slug: REPAIR_GROUP, now: 3000 });
    expect(() => transition(state, { kind: 'retry', group: REPAIR_GROUP }, 3100)).toThrow();
  });
});
