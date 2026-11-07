import type { ObserversView } from '../observerTypes.ts';
import type {
  BackgroundProcessView,
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from '../types.ts';

export type OpenedState = 'listed' | 'loading' | 'missing' | null;

/** The observers as they were when nothing in them changed. */
export function sameObservers(current: ObserversView | null, next: ObserversView): ObserversView {
  return current !== null && JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

/** What the stream last said about background processes. */
export interface StreamedProcesses {
  processes: BackgroundProcessView[] | null;
  error: string | null;
}

/** Loading of the finished runs the stream does not carry. */
export interface HistoryState {
  loading: boolean;
  error: string | null;
  /** No older runs are left. */
  done: boolean;
  /** Loads the next page; does nothing while a page is loading or when none is left. */
  loadMore: () => void;
}

/**
 * The order of the run list: running runs first (those waiting for an answer on top, then the
 * ones not started yet, then by start time), then held runs (frozen, paused), then finished runs
 * by finish time, then runs without a finish time by creation time. A run returned to its queue
 * counts as finished.
 */
export function sortRuns(runs: Iterable<RunView>): RunView[] {
  const part = (run: RunView): number => {
    if (run.state === 'queued') return run.finishedAt !== null ? 2 : 3;
    if (!run.finished && run.hold !== null) return 1;
    if (!run.finished) return 0;
    return run.finishedAt !== null ? 2 : 3;
  };
  const compareId = (left: RunView, right: RunView) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  return [...runs].sort((left, right) => {
    const at = part(left);
    if (at !== part(right)) return at - part(right);
    if (at === 0) {
      const waiting = (run: RunView) => (run.state === 'needs_human' ? 0 : 1);
      if (waiting(left) !== waiting(right)) return waiting(left) - waiting(right);
      // A run that waits for a slot is not started yet: it goes first among the running.
      const idle = (run: RunView) => run.startedAt === null;
      if (idle(left) !== idle(right)) return idle(left) ? -1 : 1;
      const key = (run: RunView) => (idle(run) ? run.createdAt : (run.startedAt ?? run.createdAt));
      return key(right) - key(left) || right.createdAt - left.createdAt || compareId(left, right);
    }
    if (at === 2) {
      return (
        (right.finishedAt ?? 0) - (left.finishedAt ?? 0) ||
        right.createdAt - left.createdAt ||
        compareId(left, right)
      );
    }
    return right.createdAt - left.createdAt || compareId(left, right);
  });
}

/** The next map of runs; a run whose JSON did not change keeps its previous object. */
export function mergeRuns(current: Map<string, RunView>, list: RunView[]): Map<string, RunView> {
  const next = new Map<string, RunView>();
  let changed = list.length !== current.size;
  for (const run of list) {
    const previous = current.get(run.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(run)) next.set(run.id, previous);
    else {
      next.set(run.id, run);
      changed = true;
    }
  }
  return changed ? next : current;
}

/** The map with the run replaced; an unchanged run keeps its object. */
export function putRun(current: Map<string, RunView>, run: RunView): Map<string, RunView> {
  const previous = current.get(run.id);
  if (previous && JSON.stringify(previous) === JSON.stringify(run)) return current;
  return new Map(current).set(run.id, run);
}

/** The map with the queue of its repository replaced; an unchanged queue keeps its object. */
export function putQueue(current: Map<string, QueueView>, view: QueueView): Map<string, QueueView> {
  const previous = current.get(view.repository);
  if (previous && JSON.stringify(previous) === JSON.stringify(view)) return current;
  return new Map(current).set(view.repository, view);
}

/** The catalog as it was when nothing in it changed. */
export function sameTags(current: TagView[], next: TagView[]): TagView[] {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

/** The tags with those of one repository replaced; an unchanged list keeps its object. */
export function replaceTags(
  current: TagView[],
  next: TagView[],
  repository: string | null,
): TagView[] {
  if (repository === null) return current;
  const rest = current.filter((tag) => tag.repository !== repository);
  const merged = [...rest, ...next.filter((tag) => tag.repository === repository)];
  // the order of the daemon: by repository, then the order inside the repository
  merged.sort((a, b) => a.repository.localeCompare(b.repository));
  return sameTags(current, merged);
}

/** The registry as it was when nothing in it changed, so unchanged lists do not re-render. */
export function sameRepositories(
  current: RepositoryView[],
  next: RepositoryView[],
): RepositoryView[] {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}
