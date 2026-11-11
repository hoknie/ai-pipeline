import { describe, expect, it } from 'vitest';

import { findSpecialist } from '../../../src/feature/swarm-config/types/index.ts';
import {
  NETWORK_FAILURE_LIMIT,
  NETWORK_RETRY_MS,
  type NetworkSnapshot,
} from '../../../src/feature/network/types/index.ts';
import {
  type FailReason,
  type RunState,
  REPAIR_GROUP,
  describeFailReason,
  networkRetryAt,
} from '../../../src/feature/runs/types/index.ts';
import {
  dispatch,
  planDispatch,
  transition,
  waitKey,
} from '../../../src/feature/runs/machine/index.ts';
import { repairIncidents } from '../../../src/feature/observers/types/index.ts';
import { CONFIG_TEXT, finish, group, run, runningAttempt, step } from './helpers.ts';

const DOWN: NetworkSnapshot = { state: 'down', problem: 'interface wt0 is down' };

/** The running attempt of the group ends with a network failure. */
function networkFailure(
  state: RunState,
  now = 2000,
  options: { slug?: string; problem?: string; sessionId?: string | null } = {},
): void {
  const slug = options.slug ?? 'gruppa-1';
  const attempt = runningAttempt(state, slug);
  transition(
    state,
    {
      kind: 'attempt_exited',
      group: slug,
      seq: attempt.seq,
      exit: {
        sessionId: options.sessionId === undefined ? `session-${attempt.seq}` : options.sessionId,
        usage: null,
        failure: { kind: 'network', problem: options.problem ?? 'Connection error' },
        outsideChanges: [],
      },
    },
    now,
  );
}

describe('the reason network', () => {
  it('is described with the problem', () => {
    const reason: FailReason = { kind: 'network', problem: 'API Error: Connection error.' };
    expect(describeFailReason(reason)).toBe('network: API Error: Connection error.');
  });

  it('gives the end of the pause only for a failed network attempt', () => {
    const state = run(1);
    step(state);
    expect(networkRetryAt(group(state))).toBeNull();
    networkFailure(state, 2000);
    expect(networkRetryAt(group(state))).toBe(2000 + NETWORK_RETRY_MS);
    dispatch([state], 2000 + NETWORK_RETRY_MS);
    expect(networkRetryAt(group(state))).toBeNull();
  });
});

describe('a group whose attempt failed because of the network', () => {
  it('waits in queued for the same step and resumes the session, without a rejection', () => {
    const state = run(1);
    step(state);
    finish(state, 'done');
    step(state, 1600);
    networkFailure(state);
    const waiting = group(state);
    expect(waiting).toMatchObject({ status: 'queued', reason: null });
    expect(waiting.pending).toMatchObject({ stepIndex: 1, resume: true, keepRuntime: true });
    expect(waiting.attempts.at(-1)).toMatchObject({
      status: 'failed',
      reason: { kind: 'network', problem: 'Connection error' },
    });
    expect(waiting.rejections).toEqual({});
    expect(state.run.finishedAt).toBeNull();
  });

  it('does not resume a session that never started', () => {
    const state = run(1);
    step(state);
    networkFailure(state, 2000, { sessionId: null });
    expect(group(state).pending).toMatchObject({ resume: false, keepRuntime: true });
  });

  it('keeps the session to resume and the message of an attempt that failed before it started', () => {
    const state = run(1);
    step(state);
    const first = runningAttempt(state);
    first.resumeSession = 'session-1';
    first.input.message = { text: 'look at the tests', at: 1500 };
    networkFailure(state, 2000, { sessionId: null });
    expect(group(state).pending).toMatchObject({
      resume: true,
      keepRuntime: true,
      message: { text: 'look at the tests', at: 1500 },
    });
    dispatch([state], 2000 + NETWORK_RETRY_MS);
    expect(group(state).attempts[1]).toMatchObject({ resumeSession: 'session-1' });
    expect(group(state).attempts[1]?.input.message).toEqual({
      text: 'look at the tests',
      at: 1500,
    });
    networkFailure(state, 40_000, { sessionId: null });
    dispatch([state], 40_000 + NETWORK_RETRY_MS);
    expect(group(state).attempts[2]).toMatchObject({ resumeSession: 'session-1' });
  });

  it('starts again after the pause on the same step', () => {
    const state = run(1);
    step(state);
    networkFailure(state, 2000);
    expect(dispatch([state], 2000 + NETWORK_RETRY_MS - 1)).toEqual([]);
    const effects = dispatch([state], 2000 + NETWORK_RETRY_MS);
    expect(effects).toMatchObject([{ kind: 'start_attempt', group: 'gruppa-1', seq: 2 }]);
    expect(group(state).attempts[1]).toMatchObject({ stepIndex: 0, resumeSession: 'session-1' });
  });

  it('fails with the reason network at the fifth failure in a row, and the retry works', () => {
    const state = run(1);
    step(state);
    for (let index = 1; index < NETWORK_FAILURE_LIMIT; index++) {
      networkFailure(state, 2000 * index);
      expect(group(state).status).toBe('queued');
      dispatch([state], 2000 * index + NETWORK_RETRY_MS);
    }
    networkFailure(state, 20_000, { problem: 'Connection error' });
    expect(group(state)).toMatchObject({
      status: 'failed',
      reason: 'network: Connection error',
    });
    transition(state, { kind: 'retry', group: 'gruppa-1' }, 21_000);
    expect(group(state).status).toBe('queued');
  });

  it('does not count a failure of another kind in the series', () => {
    const state = run(1);
    step(state);
    for (let index = 1; index < NETWORK_FAILURE_LIMIT; index++) {
      networkFailure(state, 2000 * index);
      dispatch([state], 2000 * index + NETWORK_RETRY_MS);
    }
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: { sessionId: null, usage: null, failure: null, outsideChanges: [] },
      },
      30_000,
    );
    expect(group(state).status).toBe('failed');
    expect(group(state).reason).toBe('no report');
  });

  it('handles a report sent before the network error as usual', () => {
    const state = run(1);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'report',
        group: 'gruppa-1',
        seq: attempt.seq,
        report: { verdict: 'done', summary: 'plan done', feedback: null },
      },
      1800,
    );
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'network', problem: 'Connection error' },
          outsideChanges: [],
        },
      },
      1900,
    );
    expect(group(state).attempts[0]?.status).toBe('finished');
    expect(group(state).pending).toMatchObject({ stepIndex: 1 });
    expect(group(state).status).toBe('queued');
  });

  it('can be cancelled while it waits', () => {
    const state = run(1);
    step(state);
    networkFailure(state);
    transition(state, { kind: 'cancel', group: 'gruppa-1', reason: 'no need' }, 3000);
    expect(group(state).status).toBe('cancelled');
    expect(dispatch([state], 100_000)).toEqual([]);
  });
});

describe('planDispatch with the network', () => {
  it('holds the steps of agents while the network is down', () => {
    const state = run(2);
    const plan = planDispatch([state], 1500, DOWN);
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-1'))).toEqual({
      reason: 'network',
      problem: 'interface wt0 is down',
      until: null,
    });
    expect(plan.waits.size).toBe(2);
  });

  it('does not hold anything while the network is up or the check is off', () => {
    const state = run(1);
    expect(planDispatch([state], 1500, { state: 'up', problem: null }).start).toHaveLength(1);
    expect(planDispatch([state], 1500).start).toHaveLength(1);
    expect(dispatch([state], 1500, DOWN)).toEqual([]);
    expect(group(state).status).toBe('queued');
  });

  it('holds the split step, not a command action', () => {
    const split = run(1, {
      split: true,
      configText: CONFIG_TEXT.replace(
        '    feature:\n      steps:',
        '    feature:\n      split: { specialist: plan, max_groups: 3 }\n      steps:',
      ),
    });
    const plan = planDispatch([split], 1500, DOWN);
    expect(plan.start).toEqual([]);
    expect([...plan.waits.values()].map((wait) => wait.reason)).toEqual(['network']);

    const text = `swarm:
  max: 2
  specialists:
    coder: { name: Кодировщик }
  actions:
    lint: { run: "npm test" }
  stages:
    before_delivery: [lint]
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;
    const actions = run(1, { configText: text });
    const held = planDispatch([actions], 1500, DOWN);
    expect(held.start).toEqual([]);
    expect(held.waits.size).toBe(1);
    // finish the step and the merge: the action then starts although the network is down
    dispatch([actions], 1500);
    finish(actions, 'done');
    transition(
      actions,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'm1' } },
      2500,
    );
    const next = planDispatch([actions], 3000, DOWN);
    expect(next.start.map(({ group: started }) => started.slug)).toEqual([
      '_action-before-delivery-lint',
    ]);
  });

  it('waits until the end of the pause even when the network is up', () => {
    const state = run(1);
    step(state);
    networkFailure(state, 12_000);
    const plan = planDispatch([state], 12_001, { state: 'up', problem: null });
    expect(plan.start).toEqual([]);
    expect(plan.waits.get(waitKey(state.run.id, 'gruppa-1'))).toEqual({
      reason: 'network',
      problem: 'Connection error',
      until: 12_000 + NETWORK_RETRY_MS,
    });
    expect(
      planDispatch([state], 12_000 + NETWORK_RETRY_MS, { state: 'up', problem: null }).start,
    ).toHaveLength(1);
  });

  it('puts the network before the usage limit', () => {
    const state = run(1);
    step(state);
    const attempt = runningAttempt(state);
    transition(
      state,
      {
        kind: 'attempt_exited',
        group: 'gruppa-1',
        seq: attempt.seq,
        exit: {
          sessionId: 's',
          usage: null,
          failure: { kind: 'usage_limit', resetsAt: 90_000 },
          outsideChanges: [],
        },
      },
      2000,
    );
    expect(planDispatch([state], 3000).waits.get(waitKey(state.run.id, 'gruppa-1'))).toMatchObject({
      reason: 'limit',
    });
    expect(
      planDispatch([state], 3000, DOWN).waits.get(waitKey(state.run.id, 'gruppa-1')),
    ).toMatchObject({ reason: 'network', until: null });
  });
});

describe('a failed repair', () => {
  it('ends as after any other failure', () => {
    const state = run(1);
    state.run.config.delivery.auto = false;
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 1100);
    const [incident] = repairIncidents(state);
    const coder = findSpecialist(state.run.config, 'coder');
    if (!incident || !coder) throw new Error('no incident');
    transition(state, { kind: 'repair_start', incident, specialist: coder }, 2000);
    dispatch([state], 2100);
    networkFailure(state, 3000, { slug: REPAIR_GROUP });
    expect(group(state, REPAIR_GROUP)).toMatchObject({ status: 'failed' });
    expect(group(state, REPAIR_GROUP).pending).toBeNull();
  });
});
