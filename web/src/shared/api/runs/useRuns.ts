import { useCallback, useEffect, useMemo } from 'react';

import type { Api } from '../api.ts';
import type { ObserversView } from '../observerTypes.ts';
import { browserEventSource, type Connection, type EventSourceFactory } from '../stream.ts';
import type { DaemonMismatch, QueueView, RepositoryView, RunView, TagView } from '../types.ts';
import { connectRuns } from './connectRuns.ts';
import {
  putQueue,
  replaceTags,
  sameRepositories,
  sortRuns,
  type HistoryState,
  type OpenedState,
  type StreamedProcesses,
} from './runsState.ts';
import { useHistoryPages } from './useHistoryPages.ts';
import { useOpenedRun } from './useOpenedRun.ts';
import { useRunsStore } from './useRunsStore.ts';
import { useSelection } from './useSelection.ts';

export interface RunsResult {
  runs: RunView[];
  /** Ids of the runs of the live list (snapshot and run events), not of loaded pages. */
  listedRuns: ReadonlySet<string>;
  /** Where the opened run came from: the list, a fetch in flight, or unknown to the daemon. */
  openedState: OpenedState;
  connection: Connection;
  loaded: boolean;
  /** The repository `aip web` runs in; null until known. */
  home: string | null;
  /** Every repository to choose from: `home` first, then the daemon's list. */
  repositories: string[];
  /** The daemon's list with counters. */
  registry: RepositoryView[];
  /** Takes a fresher list, for example the answer to adding or removing a repository. */
  setRegistry: (registry: RepositoryView[]) => void;
  /** The chosen repository: `wanted` when it is in the list, otherwise `home`. */
  selected: string | null;
  /** Queue of the selected repository; null until known. */
  queue: QueueView | null;
  /** The queues of all repositories the panel knows, by repository. */
  queues: ReadonlyMap<string, QueueView>;
  /** Takes a fresher queue, for example the answer to a change made on the page. */
  setQueue: (queue: QueueView) => void;
  /** The tag catalog. */
  tags: TagView[];
  /** Takes a fresher catalog of one repository, for example the answer to creating a tag. */
  setTags: (repository: string, tags: TagView[]) => void;
  /** The daemon runs another build than `aip web`; null when the builds match or unknown. */
  daemon: DaemonMismatch;
  /** The last `processes` event of the stream; null until one arrives. */
  streamedProcesses: StreamedProcesses | null;
  /** Older finished runs, loaded page by page on demand. */
  history: HistoryState;
  /** The last `observers` event of the stream; null until one arrives. */
  streamedObservers: ObserversView | null;
}

/** Runs kept up to date from the event stream, with polling while the stream is down. */
export function useRuns(
  api: Api,
  openStream: EventSourceFactory = browserEventSource,
  /** The repository the person chose, if any; it is used only when the panel knows it. */
  wanted: string | null = null,
  /** The run of the address, if any: when the list lacks it, it is fetched by id. */
  opened: string | null = null,
  /** Receives the message of a failed fetch of the opened run. */
  onError: (message: string) => void = () => undefined,
): RunsResult {
  const { state, set, refs } = useRunsStore(opened, wanted);
  useEffect(() => connectRuns(api, openStream, set, refs), [api, openStream]);
  const history = useHistoryPages(api, set.setHistory);
  const openedState = useOpenedRun(api, state, set.setExtra, opened, onError);
  const selection = useSelection(api, state, set.setQueues, wanted);
  const { runs, extra, history: pages } = state;
  const sorted = useMemo(() => {
    const all = new Map(extra);
    for (const [id, run] of pages) all.set(id, run);
    for (const [id, run] of runs) all.set(id, run);
    return sortRuns(all.values());
  }, [runs, extra, pages]);
  const listedRuns = useMemo(() => new Set(runs.keys()), [runs]);
  const setQueue = useCallback((view: QueueView) => {
    set.setQueues((current) => putQueue(current, view));
  }, []);
  const setTags = useCallback((repository: string, next: TagView[]) => {
    set.setTags((current) => replaceTags(current, next, repository));
  }, []);
  const setRegistry = useCallback((next: RepositoryView[]) => {
    set.setRegistry((current) => sameRepositories(current, next));
  }, []);
  return {
    ...selection,
    ...state,
    runs: sorted,
    listedRuns,
    openedState,
    history,
    setRegistry,
    setQueue,
    setTags,
  };
}
