import type { RunState } from './model.ts';

/** Work groups and the split step of a run that a retry can continue. */
export function retryableGroups(state: RunState): string[] {
  const work = state.split ? [state.split, ...state.groups] : state.groups;
  return work
    .filter((group) => group.status === 'failed' || group.status === 'cancelled')
    .map((group) => group.slug);
}
