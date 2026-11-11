import { describe, expect, it } from 'vitest';

import {
  initialState,
  nextCheckDelay,
  nextState,
  redactProxy,
  snapshotOf,
  stateChanged,
} from '../../../src/feature/network/types/index.ts';

describe('nextState', () => {
  const start = initialState(true, 1000);

  it('starts up when the check is enabled and off otherwise', () => {
    expect(start).toEqual({ state: 'up', problem: null, checkedAt: null, since: 1000 });
    expect(initialState(false, 5).state).toBe('off');
  });

  it('goes down after the first failure and up after the first success', () => {
    const down = nextState(start, { kind: 'fail', problem: 'interface wt0 is down' }, 2000);
    expect(down).toEqual({
      state: 'down',
      problem: 'interface wt0 is down',
      checkedAt: 2000,
      since: 2000,
    });
    const up = nextState(down, { kind: 'ok' }, 7000);
    expect(up).toEqual({ state: 'up', problem: null, checkedAt: 7000, since: 7000 });
  });

  it('moves since only when the state changes', () => {
    const down = nextState(start, { kind: 'fail', problem: 'a' }, 2000);
    const again = nextState(down, { kind: 'fail', problem: 'b' }, 3000);
    expect(again).toMatchObject({ state: 'down', problem: 'b', checkedAt: 3000, since: 2000 });
    expect(nextState(start, { kind: 'ok' }, 4000)).toMatchObject({ since: 1000, checkedAt: 4000 });
  });

  it('is off without a check time when the check is disabled', () => {
    expect(nextState(start, { kind: 'off' }, 9000)).toEqual({
      state: 'off',
      problem: null,
      checkedAt: null,
      since: 9000,
    });
  });

  it('reports a change of state or problem only', () => {
    const down = nextState(start, { kind: 'fail', problem: 'a' }, 2000);
    expect(stateChanged(start, down)).toBe(true);
    expect(stateChanged(down, nextState(down, { kind: 'fail', problem: 'a' }, 3000))).toBe(false);
    expect(stateChanged(down, nextState(down, { kind: 'fail', problem: 'b' }, 3000))).toBe(true);
    expect(snapshotOf(down)).toEqual({ state: 'down', problem: 'a' });
  });
});

describe('nextCheckDelay', () => {
  it('uses the interval, and at most 5 seconds while down', () => {
    expect(nextCheckDelay({ enabled: true, interval: 30 }, { state: 'up' })).toBe(30_000);
    expect(nextCheckDelay({ enabled: true, interval: 30 }, { state: 'down' })).toBe(5000);
    expect(nextCheckDelay({ enabled: true, interval: 5 }, { state: 'down' })).toBe(5000);
  });

  it('rereads a disabled check every 30 seconds', () => {
    expect(nextCheckDelay({ enabled: false, interval: 3600 }, { state: 'off' })).toBe(30_000);
  });
});

describe('redactProxy', () => {
  it('drops the login and the password', () => {
    expect(redactProxy('http://user:secret@proxy.local:3128')).toBe('http://proxy.local:3128');
    expect(redactProxy('https://token@proxy.local/')).toBe('https://proxy.local');
    expect(redactProxy('http://127.0.0.1:3128')).toBe('http://127.0.0.1:3128');
    expect(redactProxy('not a url')).toBe('not a url');
  });
});
