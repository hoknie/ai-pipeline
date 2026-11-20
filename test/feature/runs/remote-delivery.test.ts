import { describe, expect, it } from 'vitest';

import {
  type RemoteBranch,
  type RunState,
  deliveryCounts,
  runPhase,
  runProblems,
} from '../../../src/feature/runs/types/index.ts';
import { type Effect, transition } from '../../../src/feature/runs/machine/index.ts';
import { occupiesSlot } from '../../../src/feature/queue/types/index.ts';

import { temporaryStorage } from '../storage.ts';

import { finish, run, step } from './helpers.ts';

const BRANCH: RemoteBranch = {
  remote: 'origin',
  branch: 'aip/run000000001',
  url: 'https://github.com/acme/app/tree/aip/run000000001',
  address: 'github.com/acme/app',
};

function mergedRun(push: boolean): RunState {
  const state = run(1, { deliveryMode: 'branch' });
  state.run.config.delivery.auto = false;
  state.run.config.delivery.push = push;
  for (const _ of ['plan', 'code', 'review', 'qa']) {
    step(state);
    finish(state, 'done', { slug: 'group-1', summary: 'done' });
  }
  transition(
    state,
    { kind: 'merge_finished', group: 'group-1', outcome: { kind: 'merged', commit: 'c1' } },
    5000,
  );
  return state;
}

const applied = { kind: 'applied' as const, files: ['a.ts'], conflicts: [], commit: 'd1' };

function deliver(state: RunState): Effect[] {
  transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
  return transition(state, { kind: 'delivery_finished', result: applied }, 7000);
}

describe('sending the branch of a delivery', () => {
  it('asks to push the branch once the branch is made, and waits with the cleanup', () => {
    const state = mergedRun(true);
    expect(deliver(state)).toEqual([{ kind: 'push', run: state.run.id }]);
    expect(state.groups[0]?.delivery.state).toBe('applied');
    expect(state.run.remoteBranch).toBeNull();
  });

  it('does not push without delivery.push', () => {
    const state = mergedRun(false);
    expect(deliver(state).map((effect) => effect.kind)).not.toContain('push');
  });

  it('keeps the remote branch and cleans up once it is pushed', () => {
    const state = mergedRun(true);
    deliver(state);
    const effects = transition(state, { kind: 'delivery_pushed', remoteBranch: BRANCH }, 8000);
    expect(state.run.remoteBranch).toEqual(BRANCH);
    expect(state.groups[0]?.delivery.state).toBe('applied');
    expect(effects.map((effect) => effect.kind)).toContain('cleanup');
  });

  it('turns the delivery into push_failed with the reason, without a cleanup', () => {
    const state = mergedRun(true);
    deliver(state);
    const effects = transition(
      state,
      { kind: 'delivery_push_failed', reason: '[rejected] (non-fast-forward)' },
      8000,
    );
    expect(effects).toEqual([]);
    expect(state.groups[0]?.delivery).toMatchObject({
      state: 'push_failed',
      reason: '[rejected] (non-fast-forward)',
    });
    expect(state.run.remoteBranch).toBeNull();
    expect(deliveryCounts(state)).toMatchObject({ applied: 0, merged: 1 });
  });

  it('counts push_failed as a failed run that stops the queue', () => {
    const state = mergedRun(true);
    deliver(state);
    transition(state, { kind: 'delivery_push_failed', reason: 'no access' }, 8000);
    expect(runPhase(state)).toBe('failed');
    expect(runProblems(state)).toMatchObject([{ reason: 'push_failed', group: 'group-1' }]);
    expect(occupiesSlot(state)).toBe(false);
  });

  it('repeats only the push when delivery is requested again, and then finishes', () => {
    const state = mergedRun(true);
    deliver(state);
    transition(state, { kind: 'delivery_push_failed', reason: 'no access' }, 8000);
    const effects = transition(
      state,
      { kind: 'deliver_requested', groups: null, force: false, files: [] },
      9000,
    );
    expect(effects).toEqual([{ kind: 'push', run: state.run.id }]);
    expect(state.run.pendingDelivery).toBeNull();
    const done = transition(state, { kind: 'delivery_pushed', remoteBranch: BRANCH }, 9500);
    expect(state.groups[0]?.delivery).toMatchObject({ state: 'applied', reason: null });
    expect(state.run.remoteBranch).toEqual(BRANCH);
    expect(done.map((effect) => effect.kind)).toContain('cleanup');
  });

  it('a retry that names the group repeats the push too', () => {
    const state = mergedRun(true);
    deliver(state);
    transition(state, { kind: 'delivery_push_failed', reason: 'x' }, 8000);
    const effects = transition(
      state,
      { kind: 'deliver_requested', groups: ['group-1'], force: false, files: [] },
      9000,
    );
    expect(effects).toEqual([{ kind: 'push', run: state.run.id }]);
  });

  it('can be marked delivered by hand while the push fails', () => {
    const state = mergedRun(true);
    deliver(state);
    transition(state, { kind: 'delivery_push_failed', reason: 'x' }, 8000);
    transition(state, { kind: 'delivered_marked', groups: null }, 9000);
    expect(state.groups[0]?.delivery).toMatchObject({ state: 'applied', manual: true });
  });
});

describe('the remote branch of a run in the database', () => {
  it('is kept with the run and is null before the push', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.remoteBranch).toBeNull();
    state.run.remoteBranch = BRANCH;
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.remoteBranch).toEqual(BRANCH);
    store.database.close();
  });
});
