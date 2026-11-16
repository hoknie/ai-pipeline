import { describe, expect, it } from 'vitest';

import { findSpecialist } from '../../../src/feature/swarm-config/types/index.ts';
import {
  type FailReason,
  type Incident,
  type RunState,
  REPAIR_GROUP,
  REPAIR_RETRY_MS,
  finishedApartFromRepair,
  isRunFinished,
  pacesRepair,
  refundsRepair,
  runPhase,
} from '../../../src/feature/runs/types/index.ts';
import {
  freezeCandidate,
  problemKeys,
  emptyQueue,
  occupiesSlot,
} from '../../../src/feature/queue/types/index.ts';
import {
  type Effect,
  dispatch,
  planDispatch,
  transition,
  waitKey,
} from '../../../src/feature/runs/machine/index.ts';
import {
  repairIncidents,
  defaultObserverSettings,
} from '../../../src/feature/observers/types/index.ts';

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
  transition(state, { kind: 'timed_out', group: 'group-1', seq: 1 }, 1100);
  return state;
}

function incidentOf(state: RunState): Incident {
  const [incident] = repairIncidents(state);
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

describe('what a failure of a repair does to the count', () => {
  const reasons: FailReason[] = [
    { kind: 'timeout' },
    { kind: 'no_report' },
    { kind: 'interrupted' },
    { kind: 'exit_code', code: 1 },
    { kind: 'no_groups' },
    { kind: 'runtime_not_found', runtime: 'claude' },
    { kind: 'runtime_disabled', runtime: 'claude' },
    { kind: 'spawn', message: 'boom' },
    { kind: 'git', message: 'boom' },
    { kind: 'skipped' },
    { kind: 'usage_limit', resetsAt: null },
    { kind: 'network', problem: 'down' },
    { kind: 'message', text: 'stop', at: 1 },
    { kind: 'paused', at: 1 },
  ];

  it('refunds the repair for failures that are nobodys fault and for runtime obstacles', () => {
    const refunded = [
      'timeout',
      'no_report',
      'interrupted',
      'runtime_not_found',
      'runtime_disabled',
      'spawn',
      'usage_limit',
      'network',
    ];
    for (const reason of reasons) {
      expect(refundsRepair(reason)).toBe(refunded.includes(reason.kind));
    }
  });

  it('paces only the failures where the agent could not run to a report', () => {
    const paced = ['timeout', 'no_report', 'interrupted', 'spawn', 'network'];
    for (const reason of reasons) {
      expect(pacesRepair(reason)).toBe(paced.includes(reason.kind));
    }
  });
});

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
    expect(state.groups.map((g) => g.slug)).toEqual(['group-1']);
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
    transition(paused, { kind: 'timed_out', group: 'group-1', seq: 1 }, 1100);
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
    expect(repairIncidents(state)).toEqual([]);
  });

  it.each(['rejected', 'needs_human'] as const)(
    '%s: the incident stays with a person',
    (verdict) => {
      const { state, incident } = repairing();
      finish(state, verdict, {
        slug: REPAIR_GROUP,
        now: 3000,
        ...(verdict === 'needs_human' ? { questions: [{ text: 'I do not know' }] } : {}),
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

  it('a timeout gives the repair back and pauses the next taking', () => {
    const { state } = repairing();
    transition(state, { kind: 'timed_out', group: REPAIR_GROUP, seq: 1 }, 3000);
    expect(state.repair?.status).toBe('failed');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.retryAt).toBe(3000 + REPAIR_RETRY_MS);
  });
});

describe('cancelling the work of an observer', () => {
  it('cancels the repair with the task and writes the reason', () => {
    const { state } = repairing();
    const effects = transition(state, { kind: 'cancel', group: null, reason: 'not needed' }, 3000);
    expect(state.repair?.status).toBe('cancelled');
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.cancelReason).toBe('not needed');
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

describe('repair keeps to the limits of the places', () => {
  it('waits for swarm.max like any agent and starts when a place is free', () => {
    const state = run(2, { max: 2 });
    step(state);
    transition(state, { kind: 'timed_out', group: 'group-1', seq: 1 }, 1100);
    transition(
      state,
      { kind: 'repair_start', incident: incidentOf(state), specialist: profile(state) },
      1200,
    );
    state.run.config.max = 1;
    expect(dispatch([state], 1300)).toEqual([]);
    expect(planDispatch([state], 1300).waits.get(waitKey(state.run.id, REPAIR_GROUP))).toEqual({
      reason: 'capacity',
      scope: 'repository',
      max: 1,
    });
    state.run.config.max = 2;
    dispatch([state], 1400);
    expect(runningAttempt(state, REPAIR_GROUP)).toBeDefined();
    expect(runningAttempt(state, 'group-2')).toBeDefined();
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
    transition(state, { kind: 'timed_out', group: 'group-1', seq: 1 }, 1100);
    transition(state, { kind: 'cancel', group: 'group-2' }, 1200);
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

  it.each(['runtime_disabled', 'runtime_not_found'] as const)(
    'gives the repair back when its runtime is unavailable (%s)',
    (kind) => {
      const { state, incident } = repairing();
      expect(state.run.repair.repairs).toBe(1);
      repairExit(state, { kind, runtime: 'claude' });
      expect(state.run.repair.repairs).toBe(0);
      expect(state.run.repair.incident).toBeNull();
      expect(state.run.repair.taken).not.toContain(incident.key);
    },
  );

  it('gives the repair back for a spawn failure, with a pause', () => {
    const { state } = repairing();
    repairExit(state, { kind: 'spawn', message: 'boom' });
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.retryAt).toBe(3000 + REPAIR_RETRY_MS);
  });

  it('the observer report spends the repair as before and sets no pause', () => {
    const { state } = repairing();
    finish(state, 'done', { slug: REPAIR_GROUP, now: 3000 });
    expect(state.run.repair.repairs).toBe(1);
    expect(state.run.repair.retryAt).toBeNull();
  });
});

describe('the pause of a failed repair', () => {
  it('a network failure gives the repair back and sets the pause', () => {
    const { state } = repairing();
    repairExit(state, { kind: 'network', problem: 'down' }, 3000);
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.retryAt).toBe(3000 + REPAIR_RETRY_MS);
  });

  it.each([
    { kind: 'usage_limit', resetsAt: 9_999_999 },
    { kind: 'runtime_disabled', runtime: 'claude' },
    { kind: 'runtime_not_found', runtime: 'claude' },
  ] as const)('a %s gives the repair back without a pause', (failure) => {
    const { state } = repairing();
    expect(state.run.repair.repairs).toBe(1);
    repairExit(state, failure);
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.retryAt).toBeNull();
  });

  it('a crash leaves the count and sets no pause', () => {
    const { state } = repairing();
    repairExit(state, { kind: 'crash', message: 'boom' });
    expect(state.run.repair.repairs).toBe(1);
    expect(state.run.repair.retryAt).toBeNull();
  });

  it('a new repair clears the pause', () => {
    const { state } = repairing();
    transition(state, { kind: 'timed_out', group: REPAIR_GROUP, seq: 1 }, 3000);
    expect(state.run.repair.retryAt).not.toBeNull();
    transition(
      state,
      { kind: 'repair_start', incident: incidentOf(state), specialist: profile(state) },
      4000,
    );
    expect(state.run.repair.retryAt).toBeNull();
  });

  it('returning the task to observers clears the pause', () => {
    const { state } = repairing();
    transition(state, { kind: 'timed_out', group: REPAIR_GROUP, seq: 1 }, 3000);
    expect(state.run.repair.retryAt).not.toBeNull();
    transition(state, { kind: 'repair_allowed', allowed: false }, 3100);
    transition(state, { kind: 'repair_allowed', allowed: true }, 3200);
    expect(state.run.repair).toMatchObject({ allowed: true, repairs: 0, retryAt: null });
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
    const incident = repairIncidents(state).find((item) => item.kind === 'delivery');
    if (!incident) throw new Error('no delivery incident');
    return transition(state, { kind: 'repair_start', incident, specialist: profile(state) }, 7000);
  }

  it('takes every group of the refused delivery and prepares the tree', () => {
    const state = refusedDelivery();
    expect(repairIncidents(state).map((item) => item.kind)).toEqual(['delivery', 'delivery']);
    const effects = startDeliveryRepair(state);
    expect(effects).toEqual([
      { kind: 'prepare_resolve', run: state.run.id, groups: ['group-1', 'group-2'], round: 1 },
    ]);
    expect(state.run.pendingDelivery).toMatchObject({
      repair: true,
      force: false,
      groups: ['group-1', 'group-2'],
    });
    expect(state.run.pendingDelivery?.message).toContain('Group 1');
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
        groups: ['group-1', 'group-2'],
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
    expect(repairIncidents(state)).toEqual([]);
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

  it('is not resumed after a restart: the incident is taken again and paused', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(state.run.repair.repairs).toBe(1);
    transition(state, { kind: 'resolve_prepared', conflicts: ['src/app.ts'] }, 7100);
    dispatch([state], 7200);
    transition(state, { kind: 'interrupted' }, 8000);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.taken).toEqual([]);
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.retryAt).toBe(8000 + REPAIR_RETRY_MS);
    expect(state.groups[0]?.delivery.state).toBe('apply_failed');
    expect(repairIncidents(state)).toHaveLength(2);
  });

  it('refunds and pauses delivery repair when restarted during tree preparation', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    expect(state.run.repair.repairs).toBe(1);
    transition(state, { kind: 'interrupted' }, 8000);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
    expect(state.run.repair.repairs).toBe(0);
    expect(state.run.repair.retryAt).toBe(8000 + REPAIR_RETRY_MS);
    expect(state.repair).toBeNull();
  });

  it('cancelling the task during preparation drops the delivery', () => {
    const state = refusedDelivery();
    startDeliveryRepair(state);
    transition(state, { kind: 'cancel', group: null, reason: 'stop' }, 7100);
    expect(state.run.pendingDelivery).toBeNull();
    expect(state.run.repair.incident).toBeNull();
  });

  it('refuses a retry of the repair group by a person', () => {
    const { state } = repairing();
    finish(state, 'rejected', { slug: REPAIR_GROUP, now: 3000 });
    expect(() => transition(state, { kind: 'retry', group: REPAIR_GROUP }, 3100)).toThrow();
  });
});

describe('repair and the limit of its specialist', () => {
  const LIMITED = CONFIG_TEXT.replace('coder: { name: Coder,', 'coder: { name: Coder, max: 1,');

  /** A run that failed and has a repair of the coder queued. */
  function repairOf(): RunState {
    const state = failedRun({ configText: LIMITED });
    startRepair(state);
    return state;
  }

  /** A run whose only group waits for the coder (or already runs it). */
  function coderRun(id: string, running: boolean): RunState {
    const state = run(1, { id, now: 3000, configText: LIMITED });
    state.run.repository = '/other';
    step(state);
    finish(state, 'done');
    if (running) step(state, 2600);
    return state;
  }

  it('makes the repair wait while an ordinary attempt of the same specialist works', () => {
    const state = repairOf();
    const coder = coderRun('run000000002', true);
    const plan = planDispatch([state, coder], 4000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, REPAIR_GROUP))).toMatchObject({
      reason: 'specialist',
      specialist: 'coder',
      max: 1,
    });
  });

  it('makes an ordinary attempt wait while the repair of the same specialist works', () => {
    const state = repairOf();
    dispatch([state], 2100);
    expect(runningAttempt(state, REPAIR_GROUP).specialist).toBe('coder');
    const coder = coderRun('run000000002', false);
    const plan = planDispatch([state, coder], 4000);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey('run000000002', 'group-1'))).toMatchObject({
      reason: 'specialist',
      specialist: 'coder',
    });
  });

  it('keeps the old way round a usage limit hold of the runtime', () => {
    const state = repairOf();
    const attempt = state.groups[0]!.attempts[0]!;
    state.groups[0]!.attempts.push({
      ...attempt,
      seq: 2,
      status: 'failed',
      runtime: 'opencode',
      reason: { kind: 'usage_limit', resetsAt: 90_000 },
      finishedAt: 2000,
    });
    const plan = planDispatch([state], 3000);
    expect(plan.waits.get(waitKey(state.run.id, REPAIR_GROUP))).toBeUndefined();
    expect(plan.start.map((entry) => entry.group.slug)).toEqual([REPAIR_GROUP]);
  });
});
