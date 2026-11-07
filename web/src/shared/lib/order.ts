import type { GroupRow, RunView, SystemStepRow } from '../api/types.ts';

const ATTENTION = ['needs_human', 'conflict', 'failed'];

/** A work group or a system step of a run. */
export type Entry = GroupRow | SystemStepRow;

export function needsAttention(group: { status: string }): boolean {
  return ATTENTION.includes(group.status);
}

/** Entries that need attention first, otherwise in their own order. */
export function orderGroups<T extends { status: string }>(groups: T[]): T[] {
  return [...groups].sort(
    (left, right) => Number(needsAttention(right)) - Number(needsAttention(left)),
  );
}

/** Work groups, then system steps; each part has the entries that need attention first. */
export function orderEntries(run: RunView): Entry[] {
  return [...orderGroups(run.groups), ...orderGroups(run.system ?? [])];
}

/** The entry a run opens on: attention among groups, among system steps, the first group, the split. */
export function defaultEntry(run: RunView): Entry | null {
  const system = run.system ?? [];
  return (
    run.groups.find(needsAttention) ??
    system.find(needsAttention) ??
    run.groups[0] ??
    system.find((row) => row.kind === 'split') ??
    system[0] ??
    null
  );
}
