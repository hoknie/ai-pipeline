import { useRef, useState } from 'react';

import type { ObserversView } from '../observerTypes.ts';
import type { Connection } from '../stream.ts';
import type {
  DaemonMismatch,
  NetworkStatus,
  QueueView,
  RepositoryView,
  RunView,
  TagView,
} from '../types.ts';
import type { RunsRefs } from './connectRuns.ts';
import type { StreamedProcesses } from './runsState.ts';
import type { RunsSetters } from './streamEvents.ts';

/** What the panel knows from the stream and the API. */
export interface RunsState {
  runs: Map<string, RunView>;
  queues: Map<string, QueueView>;
  registry: RepositoryView[];
  home: string | null;
  connection: Connection;
  loaded: boolean;
  daemon: DaemonMismatch;
  tags: TagView[];
  /** Runs fetched by id because the list (active and recent finished) lacks them. */
  extra: Map<string, RunView>;
  /** Finished runs loaded page by page. */
  history: Map<string, RunView>;
  streamedObservers: ObserversView | null;
  streamedProcesses: StreamedProcesses | null;
  /** The last `network` event of the stream; null until one arrives. */
  streamedNetwork: NetworkStatus | null;
}

/** The state of `useRuns` with its setters and the refs the connection reads. */
export function useRunsStore(
  opened: string | null,
  wanted: string | null,
): { state: RunsState; set: RunsSetters; refs: RunsRefs } {
  const [streamedObservers, setStreamedObservers] = useState<ObserversView | null>(null);
  const [streamedProcesses, setStreamedProcesses] = useState<StreamedProcesses | null>(null);
  const [streamedNetwork, setStreamedNetwork] = useState<NetworkStatus | null>(null);
  const [runs, setRuns] = useState<Map<string, RunView>>(new Map());
  const [queues, setQueues] = useState<Map<string, QueueView>>(new Map());
  const [registry, setRegistry] = useState<RepositoryView[]>([]);
  const [home, setHome] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('reconnecting');
  const [loaded, setLoaded] = useState(false);
  const [daemon, setDaemon] = useState<DaemonMismatch>(null);
  const [tags, setTags] = useState<TagView[]>([]);
  const [extra, setExtra] = useState<Map<string, RunView>>(new Map());
  const [history, setHistory] = useState<Map<string, RunView>>(new Map());
  const refs: RunsRefs = {
    opened: useRef(opened),
    extra: useRef(extra),
    home: useRef(home),
    wanted: useRef(wanted),
  };
  refs.opened.current = opened;
  refs.extra.current = extra;
  refs.home.current = home;
  refs.wanted.current = wanted;
  const state = {
    runs,
    queues,
    registry,
    home,
    connection,
    loaded,
    daemon,
    tags,
    extra,
    history,
    streamedObservers,
    streamedProcesses,
    streamedNetwork,
  };
  const set = {
    setRuns,
    setQueues,
    setRegistry,
    setHome,
    setLoaded,
    setDaemon,
    setTags,
    setExtra,
    setHistory,
    setStreamedObservers,
    setStreamedProcesses,
    setStreamedNetwork,
    setConnection,
  };
  return { state, set, refs };
}
