import type { NetworkState } from '../types/index.ts';

/** Called when `state` or `problem` of the network changes: wakes the runs and tells clients. */
export interface NetworkChangedPort {
  changed(state: NetworkState): void;
}
