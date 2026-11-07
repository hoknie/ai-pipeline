import { describe, expect, it } from 'vitest';

import { summarize } from '../../../src/feature/runs/services/index.ts';
import { topology } from '../../../src/feature/runs/types/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';
import type { Usage } from '../../../src/feature/agents/types/index.ts';

import { group, run, runningAttempt, step } from './helpers.ts';

const live: Usage = { inputTokens: 1200, outputTokens: 300, costUsd: null };
const exitOf = (usage: Usage | null, failure = null) => ({
  sessionId: null,
  usage,
  failure,
  outsideChanges: [],
});

describe('attempt_usage', () => {
  it('sets the usage of a running attempt without effects or other changes', () => {
    const state = run(1);
    step(state);
    const effects = transition(
      state,
      { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage: live }] },
      2000,
    );
    expect(effects).toEqual([]);
    expect(runningAttempt(state).usage).toEqual(live);
    expect(group(state).status).toBe('running');
    expect(group(state).attempts).toHaveLength(1);
  });

  it('replaces the previous live value', () => {
    const state = run(1);
    step(state);
    const more = { ...live, inputTokens: 5000 };
    for (const usage of [live, more]) {
      transition(
        state,
        { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage }] },
        2000,
      );
    }
    expect(runningAttempt(state).usage).toEqual(more);
  });

  it('leaves attempts that are not running alone and ignores unknown groups', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'cancel', group: null }, 10);
    const effects = transition(
      state,
      {
        kind: 'attempt_usage',
        updates: [
          { group: 'gruppa-1', seq: 1, usage: live },
          { group: 'missing', seq: 1, usage: live },
          { group: 'gruppa-1', seq: 9, usage: live },
        ],
      },
      2000,
    );
    expect(effects).toEqual([]);
    expect(group(state).attempts[0]!.usage).toBeNull();
    expect(group(state).status).toBe('cancelled');
  });
});

describe('attempt_exited and usage', () => {
  it('keeps the live usage when the exit has none', () => {
    const state = run(1);
    step(state);
    transition(
      state,
      { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage: live }] },
      2000,
    );
    transition(state, { kind: 'attempt_exited', group: 'gruppa-1', seq: 1, exit: exitOf(null) }, 3);
    expect(group(state).attempts[0]!.usage).toEqual(live);
  });

  it('takes the final usage of the exit over the live one', () => {
    const state = run(1);
    step(state);
    transition(
      state,
      { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage: live }] },
      2000,
    );
    const final = { inputTokens: 900, outputTokens: 90, costUsd: 0.5 };
    transition(
      state,
      { kind: 'attempt_exited', group: 'gruppa-1', seq: 1, exit: exitOf(final) },
      3,
    );
    expect(group(state).attempts[0]!.usage).toEqual(final);
  });

  it('saves the usage of an attempt cancelled before its process ended', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'cancel', group: null }, 10);
    const effects = transition(
      state,
      { kind: 'attempt_exited', group: 'gruppa-1', seq: 1, exit: exitOf(live) },
      11,
    );
    expect(effects).toEqual([]);
    const attempt = group(state).attempts[0]!;
    expect(attempt).toMatchObject({ status: 'cancelled', usage: live, finishedAt: 10 });
    expect(group(state).status).toBe('cancelled');
  });

  it('saves the usage of an attempt that timed out', () => {
    const state = run(1);
    step(state);
    transition(state, { kind: 'timed_out', group: 'gruppa-1', seq: 1 }, 10);
    transition(
      state,
      { kind: 'attempt_exited', group: 'gruppa-1', seq: 1, exit: exitOf(live) },
      11,
    );
    expect(group(state).attempts[0]).toMatchObject({
      status: 'failed',
      reason: { kind: 'timeout' },
      usage: live,
    });
    expect(group(state).status).toBe('failed');
  });

  it('keeps the live usage of a cancelled attempt when the exit has none', () => {
    const state = run(1);
    step(state);
    transition(
      state,
      { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage: live }] },
      2000,
    );
    transition(state, { kind: 'cancel', group: null }, 10);
    transition(
      state,
      { kind: 'attempt_exited', group: 'gruppa-1', seq: 1, exit: exitOf(null) },
      11,
    );
    expect(group(state).attempts[0]!.usage).toEqual(live);
  });
});

describe('sums with a running attempt', () => {
  it('count live usage in the summary and the topology', () => {
    const state = run(1);
    step(state);
    transition(
      state,
      { kind: 'attempt_usage', updates: [{ group: 'gruppa-1', seq: 1, usage: live }] },
      2000,
    );
    expect(summarize(state).usage).toEqual(live);
    expect(topology(state).steps[0]?.usage).toEqual(live);
  });
});
