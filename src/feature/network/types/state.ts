import { type NetworkCheck, type NetworkSnapshot, type NetworkState } from './network.ts';

export { redactProxy } from '../../swarm-config/types/index.ts';

/** Checks of a disabled network are repeated this often to notice that it was enabled. */
export const NETWORK_REREAD_MS = 30_000;

/** Seconds between checks while the network is down, at most. */
export const NETWORK_DOWN_INTERVAL_SECONDS = 5;

export function initialState(enabled: boolean, now: number): NetworkState {
  return { state: enabled ? 'up' : 'off', problem: null, checkedAt: null, since: now };
}

/** The state after a check: `down` on the first failure, `up` on the first success. */
export function nextState(previous: NetworkState, check: NetworkCheck, now: number): NetworkState {
  const state = check.kind === 'off' ? 'off' : check.kind === 'ok' ? 'up' : 'down';
  return {
    state,
    problem: check.kind === 'fail' ? check.problem : null,
    checkedAt: check.kind === 'off' ? null : now,
    since: state === previous.state ? previous.since : now,
  };
}

/** Whether subscribers have to hear about the change. */
export function stateChanged(before: NetworkState, after: NetworkState): boolean {
  return before.state !== after.state || before.problem !== after.problem;
}

export function snapshotOf(state: NetworkState): NetworkSnapshot {
  return { state: state.state, problem: state.problem };
}

/** Milliseconds to the next check. */
export function nextCheckDelay(
  settings: { enabled: boolean; interval: number },
  state: Pick<NetworkState, 'state'>,
): number {
  if (!settings.enabled) return NETWORK_REREAD_MS;
  const seconds =
    state.state === 'down'
      ? Math.min(settings.interval, NETWORK_DOWN_INTERVAL_SECONDS)
      : settings.interval;
  return seconds * 1000;
}
