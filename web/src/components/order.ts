import type { GroupRow } from '../types.ts';

const ATTENTION = ['needs_human', 'conflict', 'failed'];

export function needsAttention(group: GroupRow): boolean {
  return ATTENTION.includes(group.status);
}

/** Groups that need attention first, otherwise in their own order. */
export function orderGroups(groups: GroupRow[]): GroupRow[] {
  return [...groups].sort(
    (left, right) => Number(needsAttention(right)) - Number(needsAttention(left)),
  );
}
