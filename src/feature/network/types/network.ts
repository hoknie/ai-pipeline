/** Whether the check is off, or the last check passed (`up`) or failed (`down`). */
export type NetworkMode = 'off' | 'up' | 'down';

/** The state of the network the daemon holds. */
export interface NetworkState {
  state: NetworkMode;
  /** Why the last check failed; null unless `down`. */
  problem: string | null;
  /** When the last check ended (ms); null before the first one. */
  checkedAt: number | null;
  /** When `state` last changed (ms). */
  since: number;
}

/** What a run needs to know to hold its agents. */
export interface NetworkSnapshot {
  state: NetworkMode;
  problem: string | null;
}

/** The state with the proxy of the check, without its login and password. */
export interface NetworkStatus extends NetworkState {
  proxy: string | null;
}

/** The result of one check. */
export type NetworkCheck = { kind: 'off' } | { kind: 'ok' } | { kind: 'fail'; problem: string };

/** A group waits this long after a network failure of its attempt. */
export const NETWORK_RETRY_MS = 30_000;

/** Network failures of one step in a row after which the group fails. */
export const NETWORK_FAILURE_LIMIT = 5;

/** A check no older than this is not repeated before an agent starts. */
export const NETWORK_FRESH_MS = 10_000;

export const OFF_NETWORK: NetworkSnapshot = { state: 'off', problem: null };
