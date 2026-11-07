import type { Dispatch, SetStateAction } from 'react';

import { parseObserversView, type ObserversView } from '../observerTypes.ts';
import { isStreamEvent, type ReadEvent, type StreamEvent } from '../stream.ts';
import type {
  BackgroundProcessView,
  DaemonMismatch,
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from '../types.ts';
import {
  putQueue,
  putRun,
  sameObservers,
  sameRepositories,
  sameTags,
  mergeRuns,
  type StreamedProcesses,
} from './runsState.ts';

type Setter<T> = Dispatch<SetStateAction<T>>;

/** The state of the run list that the stream and the polling fill in. */
export interface RunsSetters {
  setRuns: Setter<Map<string, RunView>>;
  setQueues: Setter<Map<string, QueueView>>;
  setRegistry: Setter<RepositoryView[]>;
  setHome: Setter<string | null>;
  setLoaded: Setter<boolean>;
  setDaemon: Setter<DaemonMismatch>;
  setTags: Setter<TagView[]>;
  setExtra: Setter<Map<string, RunView>>;
  setHistory: Setter<Map<string, RunView>>;
  setStreamedObservers: Setter<ObserversView | null>;
  setStreamedProcesses: Setter<StreamedProcesses | null>;
  setConnection: Setter<'live' | 'reconnecting' | 'polling'>;
}

function applySnapshot(
  event: Extract<StreamEvent, { event: 'snapshot' }>,
  set: RunsSetters,
  refreshOpened: (list: RunView[]) => void,
): void {
  set.setDaemon(event.daemon ?? null);
  set.setLoaded(true);
  const list = event.runs;
  set.setRuns((current) => mergeRuns(current, list));
  refreshOpened(list);
  const catalog = event.tags;
  if (catalog) set.setTags((current) => sameTags(current, catalog));
  const known = event.repositories;
  if (known) set.setRegistry((current) => sameRepositories(current, known));
  const listed = event.queues ?? [];
  if (listed.length > 0) {
    set.setQueues((current) => listed.reduce((map, view) => putQueue(map, view), current));
  }
}

function applyRun(run: RunView, set: RunsSetters): void {
  set.setRuns((current) => putRun(current, run));
  set.setExtra((current) => (current.has(run.id) ? putRun(current, run) : current));
  set.setHistory((current) => (current.has(run.id) ? putRun(current, run) : current));
}

function applyKnown(
  event: StreamEvent,
  set: RunsSetters,
  refreshOpened: (list: RunView[]) => void,
): void {
  switch (event.event) {
    case 'daemon':
      set.setDaemon(event.daemon);
      return;
    case 'snapshot':
      applySnapshot(event, set, refreshOpened);
      return;
    case 'tags': {
      const catalog = event.tags;
      set.setTags((current) => sameTags(current, catalog));
      return;
    }
    case 'repositories': {
      const known = event.repositories;
      set.setRegistry((current) => sameRepositories(current, known));
      return;
    }
    case 'processes': {
      const processes: BackgroundProcessView[] | null = event.processes ?? null;
      set.setStreamedProcesses({ processes, error: event.error ?? null });
      return;
    }
    case 'queue': {
      const view = event.queue;
      set.setQueues((current) => putQueue(current, view));
      return;
    }
    case 'run':
      applyRun(event.run, set);
  }
}

/** Takes one event of the stream into the state. */
export function applyEvent(
  raw: ReadEvent,
  set: RunsSetters,
  refreshOpened: (list: RunView[]) => void,
): void {
  if (raw.event === 'observers') {
    const view = parseObserversView((raw as { observers?: unknown }).observers ?? raw);
    if (view) set.setStreamedObservers((current) => sameObservers(current, view));
    return;
  }
  // an event this panel does not know must not reach the branch of a run
  if (isStreamEvent(raw)) applyKnown(raw, set, refreshOpened);
}
