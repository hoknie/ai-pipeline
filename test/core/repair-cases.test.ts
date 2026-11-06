import { describe, expect, it } from 'vitest';

import { findSpecialist } from '../../src/config/index.ts';
import {
  REPAIR_GROUP,
  advance,
  defaultObserverSettings,
  dispatch,
  emptyQueue,
  limitHolds,
  itemStarted,
  occupiesSlot,
  pauseRun,
  planDispatch,
  planRepairs,
  repairAdmitted,
  repairIncidents,
  specialistUse,
  transition,
  type Incident,
  type RunState,
} from '../../src/core/index.ts';

import { finish, run, runningAttempt, step } from './helpers.ts';

const SETTINGS = {
  ...defaultObserverSettings(),
  enabled: true,
  projects: [{ repository: '/repo', maxWorkers: null }],
};

const applied = { kind: 'applied' as const, files: ['src/app.ts'], conflicts: [], commit: null };
const refused = {
  kind: 'refused' as const,
  reason: 'the changes conflict with your working tree',
  files: ['src/app.ts'],
  conflict: true,
};

function profile(state: RunState) {
  const found = findSpecialist(state.run.config, 'coder');
  if (!found) throw new Error('no coder');
  return found;
}

function failedRun(groups = 1, auto = false): RunState {
  const state = run(groups);
  state.run.config.delivery.auto = auto;
  step(state);
  for (let index = 1; index <= groups; index += 1) {
    transition(state, { kind: 'timed_out', group: `gruppa-${index}`, seq: 1 }, 1100);
  }
  return state;
}

function incidentOf(state: RunState): Incident {
  const [incident] = repairIncidents(state, SETTINGS);
  if (!incident) throw new Error('no incident');
  return incident;
}

function startRepair(state: RunState, now = 2000): Incident {
  const incident = incidentOf(state);
  transition(state, { kind: 'repair_start', incident, specialist: profile(state) }, now);
  return incident;
}

function refusedDelivery(): RunState {
  const state = run(2);
  state.run.config.delivery.auto = false;
  for (const _ of ['plan', 'code', 'review', 'qa']) {
    step(state);
    for (const g of state.groups) finish(state, 'done', { slug: g.slug, summary: `${g.title} ok` });
  }
  for (const g of state.groups) {
    transition(
      state,
      { kind: 'merge_finished', group: g.slug, outcome: { kind: 'merged', commit: `c-${g.slug}` } },
      5000,
    );
  }
  transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
  transition(state, { kind: 'delivery_finished', result: refused }, 6100);
  return state;
}

function startDeliveryRepair(state: RunState): Incident {
  const incident = repairIncidents(state, SETTINGS).find((item) => item.kind === 'delivery');
  if (!incident) throw new Error('no delivery incident');
  transition(state, { kind: 'repair_start', incident, specialist: profile(state) }, 7000);
  return incident;
}

function conflicted(): RunState {
  const state = refusedDelivery();
  startDeliveryRepair(state);
  transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
  dispatch([state], 7200);
  return state;
}

describe('pause during the repair of a delivery', () => {
  function expectPaused(state: RunState): void {
    expect(state.run.hold).toBe('paused');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.taken).toEqual([]);
    expect(state.run.pendingDelivery).toBeNull();
    expect(repairAdmitted(state, SETTINGS)).toBe(false);
    expect(planRepairs(SETTINGS, [state], new Map())).toEqual([]);
  }

  function expectTakenAgain(state: RunState): void {
    transition(state, { kind: 'hold', hold: null }, 9100);
    expect(repairAdmitted(state, SETTINGS)).toBe(true);
    expect(repairIncidents(state, SETTINGS)).toHaveLength(2);
  }

  it('keeps the hold while the group works', () => {
    const state = conflicted();
    transition(state, { kind: 'hold', hold: 'paused' }, 9000);
    expectPaused(state);
    expectTakenAgain(state);
  });

  it('keeps the hold while the tree is prepared', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(state.repair).toBeNull();
    transition(state, { kind: 'hold', hold: 'paused' }, 9000);
    expectPaused(state);
    expectTakenAgain(state);
  });

  it('keeps the returned item in the queue and lets the pause be lifted', () => {
    const state = conflicted();
    const queue = emptyQueue('/repo', 8500);
    const item = pauseRun(queue, state, 'item-1', 8500);
    transition(state, { kind: 'hold', hold: 'paused' }, 9000);
    expectPaused(state);
    advance(queue, [state], (id) => (id === state.run.id ? state : undefined), 9050);
    expect(queue.items).toContain(item);
    // taking the item, as takeReturned does
    transition(state, { kind: 'hold', hold: null }, 9100);
    itemStarted(queue, item.id, state.run.id, 9100);
    expect(repairAdmitted(state, SETTINGS)).toBe(true);
    expect(planRepairs(SETTINGS, [state], new Map())).toHaveLength(1);
  });

  it('keeps the hold after done, before the delivery ends', () => {
    const state = conflicted();
    finish(state, 'done', { slug: REPAIR_GROUP, now: 8000 });
    expect(state.run.pendingDelivery?.repair).toBe(true);
    transition(state, { kind: 'hold', hold: 'paused' }, 9000);
    expectPaused(state);
    expectTakenAgain(state);
  });
});

describe('limit of the repair', () => {
  it('waits for no limit in planDispatch: the group starts', () => {
    const state = failedRun(2);
    // gruppa-2 hit the limit of the runtime
    const attempt = state.groups[1]!.attempts[0]!;
    attempt.reason = { kind: 'usage_limit', resetsAt: 9_999_999 } as never;
    startRepair(state);
    const plan = planDispatch([state], 2100);
    expect(plan.waits.size).toBe(0);
    expect(plan.start.map((item) => item.group.slug)).toContain(REPAIR_GROUP);
  });

  it('ends the repair and holds the observer until the reset', () => {
    const state = failedRun();
    startRepair(state);
    dispatch([state], 2100);
    const attempt = runningAttempt(state, REPAIR_GROUP);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: REPAIR_GROUP,
        seq: attempt.seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 9_999_999 } as never,
          outsideChanges: [],
        },
      },
      3000,
    );
    expect(state.repair?.status).toBe('failed');
    expect(state.run.repair.incident).toBeNull();
    const holds = limitHolds([state], 3100);
    expect(holds.size).toBe(1);
    const [runtime] = [...holds.keys()];
    const settings = { ...SETTINGS, specialist: { ...SETTINGS.specialist, runtime } };
    expect(planRepairs(settings, [state], holds)).toEqual([]);
    const later = limitHolds([state], 10_000_000);
    expect(planRepairs(settings, [state], later)).toHaveLength(1);
  });
});

describe('repair of the next incident', () => {
  it('queues the same group again with a fresh attempt', () => {
    const state = failedRun(2);
    const first = startRepair(state);
    dispatch([state], 2100);
    const task = state.repair!.task;
    finish(state, 'done', { slug: REPAIR_GROUP, now: 3000 });
    expect(state.repair?.status).toBe('merged');
    const second = startRepair(state, 3100);
    expect(second.key).not.toBe(first.key);
    const group = state.repair!;
    expect(group.status).toBe('queued');
    expect(group.reason).toBeNull();
    expect(group.pending).not.toBeNull();
    expect(group.task).not.toBe(task);
    dispatch([state], 3200);
    expect(runningAttempt(state, REPAIR_GROUP).seq).toBe(2);
  });
});

describe('skipped task under repair', () => {
  function queueOf(state: RunState) {
    const queue = emptyQueue('/repo', 1);
    queue.skipFailed = true;
    queue.runs.push(state.run.id);
    return queue;
  }

  it.each([false, true])('stays skipped during the repair (auto delivery %s)', (auto) => {
    const state = failedRun(1, auto);
    const queue = queueOf(state);
    const lookup = (id: string) => (id === state.run.id ? state : undefined);
    advance(queue, [state], lookup, 1200);
    expect(queue.skipped).toContain(state.run.id);
    expect(queue.runs).not.toContain(state.run.id);
    startRepair(state);
    dispatch([state], 2100);
    advance(queue, [state], lookup, 2200);
    expect(queue.skipped).toContain(state.run.id);
    expect(queue.runs).not.toContain(state.run.id);
    expect(occupiesSlot(state)).toBe(false);
    finish(state, 'done', { slug: REPAIR_GROUP, now: 3000 });
    advance(queue, [state], lookup, 3100);
    expect(queue.runs).not.toContain(state.run.id);
    transition(state, { kind: 'retry', group: 'gruppa-1' }, 3200);
    advance(queue, [state], lookup, 3300);
    expect(queue.skipped).not.toContain(state.run.id);
    expect(queue.runs).toContain(state.run.id);
  });
});

describe('restart during a repair', () => {
  it('fails the running group and gives the incident back', () => {
    const state = failedRun();
    startRepair(state);
    dispatch([state], 2100);
    transition(state, { kind: 'interrupted' }, 3000);
    expect(state.repair?.status).toBe('failed');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(state.run.repair.repairs).toBe(1);
    expect(repairIncidents(state, SETTINGS)).toHaveLength(1);
  });

  it('starts a queued repair after the restart', () => {
    const state = failedRun();
    startRepair(state);
    transition(state, { kind: 'interrupted' }, 3000);
    expect(state.repair?.status).toBe('queued');
    expect(state.run.repair.incident).not.toBeNull();
    expect(state.run.repair.repairs).toBe(1);
    dispatch([state], 3100);
    expect(state.repair?.status).toBe('running');
  });

  it('closes a delivery repair whose group is queued', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
    expect(state.repair?.status).toBe('queued');
    transition(state, { kind: 'interrupted' }, 8000);
    expect(state.repair?.status).toBe('failed');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
  });

  it('drops a delivery whose tree is still prepared', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(state.repair).toBeNull();
    transition(state, { kind: 'interrupted' }, 8000);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(repairIncidents(state, SETTINGS)).toHaveLength(2);
  });
});

describe('cancelling the task while the tree is prepared', () => {
  it('cancels a repair of a delivery that has no group yet', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(state.repair).toBeNull();
    transition(state, { kind: 'cancel', group: REPAIR_GROUP }, 7100);
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.pendingDelivery).toBeNull();
  });

  it('cancels the group of a delivery repair with the task', () => {
    const state = conflicted();
    transition(state, { kind: 'cancel', group: null, reason: 'стоп' }, 8000);
    expect(state.repair?.status).toBe('cancelled');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.pendingDelivery).toBeNull();
  });
});

describe('delivery repair outcomes', () => {
  it('counts one repair for several groups', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(state.run.repair.repairs).toBe(1);
    expect(state.run.pendingDelivery?.groups).toHaveLength(2);
  });

  it('without conflicts delivers at once and takes every key', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'resolve_prepared', conflicts: [] }, 7100);
    transition(state, { kind: 'delivery_finished', result: applied }, 7200);
    expect(state.run.repair.repairs).toBe(1);
    expect(state.run.repair.taken).toHaveLength(2);
    expect(state.groups.map((g) => g.delivery.state)).toEqual(['applied', 'applied']);
    expect(repairIncidents(state, SETTINGS)).toEqual([]);
  });

  it('a timeout of the agent keeps the keys free', () => {
    const state = conflicted();
    transition(state, { kind: 'timed_out', group: REPAIR_GROUP, seq: 1 }, 8000);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(state.groups.map((g) => g.delivery.state)).toEqual(['apply_failed', 'apply_failed']);
    expect(repairIncidents(state, SETTINGS)).toHaveLength(2);
  });

  it('a delivery that failed without an attempt ends the repair and takes the keys', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(
      state,
      { kind: 'delivery_finished', result: { kind: 'failed', message: 'x' } },
      7100,
    );
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.taken).toHaveLength(2);
  });

  it('no incident of a delivery is taken while another delivery goes on', () => {
    const state = refusedDelivery();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6200);
    expect(state.run.pendingDelivery).not.toBeNull();
    expect(planRepairs(SETTINGS, [state], new Map())).toEqual([]);
  });
});

describe('repair group in the use of specialists', () => {
  it('shows the profile of the repair without a limit', () => {
    const state = failedRun();
    startRepair(state);
    dispatch([state], 2100);
    const uses = specialistUse(state);
    const use = uses.find((item) => item.running.some((r) => r.slug === REPAIR_GROUP));
    expect(use).toBeDefined();
    expect(use?.specialist).toBe('coder');
    expect(use?.max).toBeNull();
    expect(use?.running[0]?.stepName).toBe('Кодировщик');
  });
});
