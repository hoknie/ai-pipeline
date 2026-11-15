import { isRepairing } from '../api/observerTypes.ts';
import type { GroupRow, RunView, SystemStepRow } from '../api/types.ts';

const HUMAN_ATTENTION = ['needs_human', 'conflict'];
const ATTENTION = ['needs_human', 'conflict', 'failed'];

/** A work group or a system step of a run. */
export type Entry = GroupRow | SystemStepRow;

export function isObserver(entry: { slug?: string; kind?: string }): boolean {
  return ('kind' in entry && entry.kind === 'repair') || entry.slug === '_repair';
}

export function isActive(entry: { status: string }): boolean {
  return entry.status === 'running' || entry.status === 'merging';
}

export function needsAttention(group: { status: string; slug?: string; kind?: string }): boolean {
  if (isObserver(group) && !isActive(group)) return false;
  return ATTENTION.includes(group.status);
}

/** Entries that need attention first, otherwise in their own order. */
export function orderGroups<T extends { status: string; slug?: string; kind?: string }>(
  groups: T[],
): T[] {
  return [...groups].sort(
    (left, right) => Number(needsAttention(right)) - Number(needsAttention(left)),
  );
}

/** Work groups, then system steps; each part has the entries that need attention first. */
export function orderEntries(run: RunView): Entry[] {
  return [...orderGroups(run.groups), ...orderGroups(run.system ?? [])];
}

/** The entry a run opens on: human attention, active part, failed entry, the first group, the split. */
export function defaultEntry(run: RunView): Entry | null {
  const system = run.system ?? [];
  const runActive = !run.finished && run.state !== 'finished';
  const observerWorking = (entry: Entry) =>
    isObserver(entry) && runActive && (isActive(entry) || isRepairing(run));
  const eligibleSystem = system.filter((row) => !isObserver(row) || observerWorking(row));
  const isEntryActive = (entry: Entry) =>
    runActive && (isActive(entry) || (isObserver(entry) && isRepairing(run)));
  const humanWait = (entry: Entry) => HUMAN_ATTENTION.includes(entry.status);
  const failed = (entry: Entry) => entry.status === 'failed';

  return (
    run.groups.find(humanWait) ??
    eligibleSystem.find(humanWait) ??
    run.groups.find(isEntryActive) ??
    eligibleSystem.find(isEntryActive) ??
    run.groups.find(failed) ??
    eligibleSystem.find(failed) ??
    run.groups[0] ??
    system.find((row) => row.kind === 'split') ??
    eligibleSystem[0] ??
    system[0] ??
    null
  );
}
