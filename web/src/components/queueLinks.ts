import type { DependencyView, QueueItemView, QueueView, RunView } from '../types.ts';

/** Deepest branch indent: longer chains do not indent further. */
export const MAX_DEPTH = 3;

type Linked = Pick<QueueView, 'items'>;

/** The items that wait for `id` (an item or a run). */
export function dependents(queue: Linked, id: string): QueueItemView[] {
  return queue.items.filter((item) => item.after.some((ref) => ref.id === id));
}

/**
 * `id` together with everything linked to it: predecessors and dependents, transitively in both
 * directions. Items and runs share one id space, so a run id is part of the result too.
 */
export function related(queue: Linked, id: string): Set<string> {
  const result = new Set<string>([id]);
  const walk = (start: string, next: (at: string) => string[]) => {
    const pending = [start];
    while (pending.length > 0) {
      const at = pending.pop() as string;
      for (const other of next(at)) {
        if (result.has(other) && other !== start) continue;
        result.add(other);
        pending.push(other);
      }
    }
  };
  const byId = new Map(queue.items.map((item) => [item.id, item]));
  walk(id, (at) => (byId.get(at)?.after ?? []).map((ref) => ref.id));
  walk(id, (at) => dependents(queue, at).map((item) => item.id));
  return result;
}

/** Length of the longest chain of waiting predecessors of the item, at most `MAX_DEPTH`. */
export function depth(queue: Linked, id: string): number {
  const byId = new Map(queue.items.map((item) => [item.id, item]));
  const measure = (at: string, seen: Set<string>): number => {
    const item = byId.get(at);
    if (!item || seen.has(at)) return 0;
    const next = new Set(seen).add(at);
    let longest = 0;
    for (const ref of item.after) {
      if (ref.kind !== 'item' || !byId.has(ref.id)) continue;
      longest = Math.max(longest, 1 + measure(ref.id, next));
    }
    return Math.min(longest, MAX_DEPTH);
  };
  return measure(id, new Set());
}

/** The predecessors that are not done yet. */
export function unmet(item: Pick<QueueItemView, 'after'>): DependencyView[] {
  return item.after.filter((ref) => ref.state !== 'done');
}

export interface AfterOption {
  id: string;
  /** Task number of the predecessor; null when unknown. */
  number: number | null;
  title: string;
  kind: 'item' | 'run' | 'current';
}

/**
 * What a task can wait for: queued items (not the edited one), runs that hold a place and, when
 * editing, its current predecessors, which may no longer be in either list. Without repeats.
 */
export function afterOptions(
  queue: Pick<QueueView, 'items' | 'runs'>,
  label: (item: QueueItemView) => string,
  editing?: QueueItemView,
): AfterOption[] {
  const result = new Map<string, AfterOption>();
  for (const item of queue.items)
    if (item.id !== editing?.id)
      result.set(item.id, { id: item.id, number: item.number, title: label(item), kind: 'item' });
  for (const run of queue.runs)
    result.set(run.id, { id: run.id, number: run.number, title: run.title, kind: 'run' });
  for (const ref of editing?.after ?? [])
    if (!result.has(ref.id))
      result.set(ref.id, {
        id: ref.id,
        number: ref.number,
        title: ref.title || ref.id,
        kind: 'current',
      });
  return [...result.values()];
}

export interface ParentChoice {
  id: string;
  number: number;
  title: string;
  /** In progress, planned (not started or put back in the queue) or finished. */
  section: 'active' | 'planned' | 'finished';
}

const SECTION_ORDER: Record<ParentChoice['section'], number> = {
  active: 0,
  planned: 1,
  finished: 2,
};

/**
 * The runs of `repository` a task can be a child of, finished ones included: in progress first
 * (newest start first), then planned (newest created first), then finished (latest finish first).
 */
export function parentChoices(runs: readonly RunView[], repository: string): ParentChoice[] {
  const keyed = runs
    .filter((run) => run.repository === repository)
    .map((run) => {
      const section: ParentChoice['section'] = run.finished
        ? 'finished'
        : run.state === 'queued' || run.startedAt === null
          ? 'planned'
          : 'active';
      const key =
        section === 'finished'
          ? (run.finishedAt ?? run.createdAt)
          : section === 'active'
            ? (run.startedAt ?? run.createdAt)
            : run.createdAt;
      return { run, section, key };
    });
  keyed.sort(
    (a, b) =>
      SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
      b.key - a.key ||
      b.run.createdAt - a.run.createdAt ||
      a.run.id.localeCompare(b.run.id),
  );
  return keyed.map(({ run, section }) => ({
    id: run.id,
    number: run.number,
    title: run.title,
    section,
  }));
}
