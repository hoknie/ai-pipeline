import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, type Api } from './api.ts';
import { repositoryList } from './repositories.ts';
import type {
  BackgroundProcessView,
  DaemonMismatch,
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from './types.ts';

export type OpenedState = 'listed' | 'loading' | 'missing' | null;

export type Connection = 'live' | 'reconnecting' | 'polling';

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export const browserEventSource: EventSourceFactory = (url) => new EventSource(url);

type StreamEvent =
  | {
      event: 'snapshot';
      runs: RunView[];
      queues?: QueueView[];
      repositories?: RepositoryView[];
      tags?: TagView[];
      daemon?: DaemonMismatch;
    }
  | { event: 'daemon'; daemon: DaemonMismatch }
  | { event: 'repositories'; repositories: RepositoryView[] }
  | { event: 'tags'; repository?: string; tags: TagView[] }
  | { event: 'run'; run: RunView }
  | { event: 'queue'; queue: QueueView }
  | { event: 'processes'; processes?: BackgroundProcessView[]; error?: string };

/** What the stream last said about background processes. */
export interface StreamedProcesses {
  processes: BackgroundProcessView[] | null;
  error: string | null;
}

export function sortRuns(runs: Iterable<RunView>): RunView[] {
  return [...runs].sort((left, right) => {
    // A finished run waiting in the queue as a return item counts as unfinished.
    const rank = (run: RunView) =>
      run.state === 'queued' ? 1 : run.finished ? 2 : run.state === 'needs_human' ? 0 : 1;
    if (rank(left) !== rank(right)) return rank(left) - rank(right);
    // A run that waits for a slot is not started yet: it goes first among the unfinished.
    const waiting = (run: RunView) =>
      run.state === 'queued' || (!run.finished && run.startedAt === null);
    if (waiting(left) !== waiting(right)) return waiting(left) ? -1 : 1;
    const key = (run: RunView) => (waiting(run) ? run.createdAt : (run.startedAt ?? run.createdAt));
    return (
      key(right) - key(left) ||
      right.createdAt - left.createdAt ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
  });
}

/** The next map of runs; a run whose JSON did not change keeps its previous object. */
function mergeRuns(current: Map<string, RunView>, list: RunView[]): Map<string, RunView> {
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
function putRun(current: Map<string, RunView>, run: RunView): Map<string, RunView> {
  const previous = current.get(run.id);
  if (previous && JSON.stringify(previous) === JSON.stringify(run)) return current;
  return new Map(current).set(run.id, run);
}

/** The map with the queue of its repository replaced; an unchanged queue keeps its object. */
function putQueue(current: Map<string, QueueView>, view: QueueView): Map<string, QueueView> {
  const previous = current.get(view.repository);
  if (previous && JSON.stringify(previous) === JSON.stringify(view)) return current;
  return new Map(current).set(view.repository, view);
}

/** The catalog as it was when nothing in it changed. */
function sameTags(current: TagView[], next: TagView[]): TagView[] {
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
function sameRepositories(current: RepositoryView[], next: RepositoryView[]): RepositoryView[] {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

const POLL_MS = 3000;
/** After this long without the stream, fall back to polling the API. */
const POLL_AFTER_MS = 4000;

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
): {
  runs: RunView[];
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
} {
  const [streamedProcesses, setStreamedProcesses] = useState<StreamedProcesses | null>(null);
  const [runs, setRuns] = useState<Map<string, RunView>>(new Map());
  const [queues, setQueues] = useState<Map<string, QueueView>>(new Map());
  const [registry, setRegistryState] = useState<RepositoryView[]>([]);
  const [home, setHome] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('reconnecting');
  const [loaded, setLoaded] = useState(false);
  const [daemon, setDaemon] = useState<DaemonMismatch>(null);
  const [tags, setTags] = useState<TagView[]>([]);
  // Runs fetched by id because the list (active and recent finished) lacks them.
  const [extra, setExtra] = useState<Map<string, RunView>>(new Map());
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const homeRef = useRef(home);
  homeRef.current = home;
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let closed = false;
    let poller: ReturnType<typeof setInterval> | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;

    /** Fetches the opened run again when only the by-id copy of it exists. */
    const refreshOpened = (listed: RunView[]) => {
      const id = openedRef.current;
      if (id === null || !extraRef.current.has(id) || listed.some((run) => run.id === id)) return;
      api
        .run(id)
        .then((run) => {
          if (!closed) setExtra((current) => putRun(current, run));
        })
        .catch(() => {
          // the previous copy stays
        });
    };
    const loadQueue = async () => {
      try {
        const view = await api.queue();
        if (closed) return;
        setHome(view.repository);
        setQueues((current) => putQueue(current, view));
      } catch {
        // the queue stays as it was
      }
    };
    const poll = async () => {
      try {
        const list = await api.runs();
        if (closed) return;
        setRuns((current) => mergeRuns(current, list));
        setLoaded(true);
        refreshOpened(list);
        const known = await api.repositories();
        if (closed) return;
        setRegistryState((current) => sameRepositories(current, known));
        const catalog = await api.tags();
        if (closed) return;
        setTags((current) => replaceTags(current, catalog, homeRef.current));
        const chosen = wantedRef.current;
        if (chosen !== null && chosen !== homeRef.current) {
          const more = await api.forRepository(chosen).tags();
          if (closed) return;
          setTags((current) => replaceTags(current, more, chosen));
        }
      } catch {
        // the server is unreachable; keep the last known state
      }
      await loadQueue();
    };
    void loadQueue();
    const stopPolling = () => {
      if (poller) clearInterval(poller);
      if (fallback) clearTimeout(fallback);
      poller = null;
      fallback = null;
    };
    const startPolling = () => {
      if (poller || fallback) return;
      fallback = setTimeout(() => {
        fallback = null;
        if (closed) return;
        setConnection('polling');
        void poll();
        poller = setInterval(() => void poll(), POLL_MS);
      }, POLL_AFTER_MS);
    };

    const source = openStream('/api/events');
    source.onopen = () => {
      stopPolling();
      setConnection('live');
    };
    source.onmessage = (message) => {
      let event: StreamEvent;
      try {
        event = JSON.parse(message.data) as StreamEvent;
      } catch {
        return;
      }
      stopPolling();
      setConnection('live');
      setLoaded(true);
      if (event.event === 'daemon') {
        setDaemon(event.daemon);
      } else if (event.event === 'snapshot') {
        setDaemon(event.daemon ?? null);
        const list = event.runs;
        setRuns((current) => mergeRuns(current, list));
        refreshOpened(list);
        const catalog = event.tags;
        if (catalog) setTags((current) => sameTags(current, catalog));
        const known = event.repositories;
        if (known) setRegistryState((current) => sameRepositories(current, known));
        const listed = event.queues ?? [];
        if (listed.length > 0) {
          setQueues((current) => listed.reduce((map, view) => putQueue(map, view), current));
        }
      } else if (event.event === 'tags') {
        const catalog = event.tags;
        setTags((current) => sameTags(current, catalog));
      } else if (event.event === 'repositories') {
        const known = event.repositories;
        setRegistryState((current) => sameRepositories(current, known));
      } else if (event.event === 'processes') {
        setStreamedProcesses({ processes: event.processes ?? null, error: event.error ?? null });
      } else if (event.event === 'queue') {
        const view = event.queue;
        setQueues((current) => putQueue(current, view));
      } else {
        const run = event.run;
        setRuns((current) => {
          const previous = current.get(run.id);
          if (previous && JSON.stringify(previous) === JSON.stringify(run)) return current;
          return new Map(current).set(run.id, run);
        });
        setExtra((current) => (current.has(run.id) ? putRun(current, run) : current));
      }
    };
    source.onerror = () => {
      setConnection((current) => (current === 'polling' ? current : 'reconnecting'));
      startPolling();
    };
    return () => {
      closed = true;
      stopPolling();
      source.close();
    };
  }, [api, openStream]);

  const sorted = useMemo(() => {
    const all = new Map(extra);
    for (const [id, run] of runs) all.set(id, run);
    return sortRuns(all.values());
  }, [runs, extra]);
  const listed = opened !== null && runs.has(opened);
  const known = opened !== null && (listed || extra.has(opened));
  const gone = opened !== null && unknown.has(opened);
  const openedState: OpenedState =
    opened === null ? null : known ? 'listed' : gone ? 'missing' : loaded ? 'loading' : null;
  useEffect(() => {
    if (!loaded || opened === null || known || gone || inFlight.current.has(opened)) return;
    inFlight.current.add(opened);
    api
      .run(opened)
      .then((run) => setExtra((current) => putRun(current, run)))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setUnknown((current) => new Set(current).add(opened));
        } else {
          onErrorRef.current(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => inFlight.current.delete(opened));
  }, [api, loaded, opened, known, gone]);
  const setQueue = useCallback((view: QueueView) => {
    setQueues((current) => putQueue(current, view));
  }, []);
  const updateTags = useCallback((repository: string, next: TagView[]) => {
    setTags((current) => replaceTags(current, next, repository));
  }, []);
  const setRegistry = useCallback((next: RepositoryView[]) => {
    setRegistryState((current) => sameRepositories(current, next));
  }, []);
  const repositories = useMemo(() => repositoryList(home, registry), [home, registry]);
  const selected = wanted !== null && repositories.includes(wanted) ? wanted : home;
  const queue = selected ? (queues.get(selected) ?? null) : null;

  // The daemon answers with an empty queue for a repository that has none yet.
  const missing = selected !== null && selected !== home && queue === null;
  useEffect(() => {
    if (!missing || selected === null) return;
    let closed = false;
    api
      .forRepository(selected)
      .queue()
      .then((view) => {
        if (!closed) setQueues((current) => putQueue(current, view));
      })
      .catch(() => {
        // the queue stays unknown; the page shows its own loading state
      });
    return () => {
      closed = true;
    };
  }, [api, missing, selected]);
  return {
    runs: sorted,
    openedState,
    streamedProcesses,
    connection,
    loaded,
    home,
    repositories,
    registry,
    setRegistry,
    selected,
    queue,
    queues,
    setQueue,
    tags,
    setTags: updateTags,
    daemon,
  };
}
