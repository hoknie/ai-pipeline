import { describe, expect, it } from 'vitest';

import type { RunState } from '../../../src/feature/runs/types/index.ts';
import { type DeliveryResult, transition } from '../../../src/feature/runs/machine/index.ts';

import { finish, group, run, step } from './helpers.ts';

const applied: DeliveryResult = { kind: 'applied', files: ['a.ts'], conflicts: [], commit: null };

function cancelled(): RunState {
  const state = run(1);
  step(state);
  transition(state, { kind: 'cancel', group: null }, 10);
  return state;
}

function merged(keep = false): RunState {
  const state = run(1);
  state.run.config.delivery.auto = false;
  state.run.config.delivery.keep = keep;
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

describe('the clean event', () => {
  it('marks a finished run once and changes no group', () => {
    const state = cancelled();
    expect(state.run.cleanedAt).toBeNull();
    expect(transition(state, { kind: 'clean' }, 100)).toEqual([]);
    expect(state.run.cleanedAt).toBe(100);
    expect(group(state).status).toBe('cancelled');
    transition(state, { kind: 'clean' }, 200);
    expect(state.run.cleanedAt).toBe(100);
  });

  it('refuses a run that is still active', () => {
    const state = run(1);
    step(state);
    expect(() => transition(state, { kind: 'clean' }, 100)).toThrow(
      'the run is still active; cancel it or wait for it to finish',
    );
    expect(state.run.cleanedAt).toBeNull();
  });

  it('refuses a retry and a delivery of a cleaned run without changing it', () => {
    const state = cancelled();
    transition(state, { kind: 'clean' }, 100);
    expect(() => transition(state, { kind: 'retry', group: 'group-1' }, 101)).toThrow(
      'run is cleaned up',
    );
    expect(group(state).status).toBe('cancelled');
    const delivered = merged();
    transition(delivered, { kind: 'clean' }, 100);
    expect(() =>
      transition(
        delivered,
        { kind: 'deliver_requested', groups: null, force: false, files: [] },
        6000,
      ),
    ).toThrow('run is cleaned up');
    expect(delivered.groups[0]?.delivery.state).toBe('pending');
  });
});

describe('a delivered run', () => {
  it('keeps the usual errors: there is nothing to deliver or retry', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
    transition(state, { kind: 'delivery_finished', result: applied }, 7000);
    expect(state.run.cleanedAt).toBe(7000);
    expect(() =>
      transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 8000),
    ).toThrow('nothing to deliver');
    expect(() => transition(state, { kind: 'retry', group: 'group-1' }, 8000)).toThrow(
      'needs failed, cancelled or conflict',
    );
  });
});

describe('the mark after a delivery', () => {
  it('is set in the transition that asks for the cleanup', () => {
    const state = merged();
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
    expect(state.run.cleanedAt).toBeNull();
    const effects = transition(state, { kind: 'delivery_finished', result: applied }, 7000);
    expect(effects).toEqual([{ kind: 'cleanup', run: state.run.id }]);
    expect(state.run.cleanedAt).toBe(7000);
  });

  it('is set by a manual mark', () => {
    const state = merged();
    transition(state, { kind: 'delivered_marked', groups: null }, 8000);
    expect(state.run.cleanedAt).toBe(8000);
  });

  it('is not set with delivery.keep', () => {
    const state = merged(true);
    transition(state, { kind: 'deliver_requested', groups: null, force: false, files: [] }, 6000);
    transition(state, { kind: 'delivery_finished', result: applied }, 7000);
    expect(state.run.cleanedAt).toBeNull();
  });
});
