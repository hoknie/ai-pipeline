import type { Api } from '../api.ts';
import { createFallback, listen, type EventSourceFactory } from '../stream.ts';
import type { RunView } from '../types.ts';
import { applyEvent, type RunsSetters } from './streamEvents.ts';
import { mergeRuns, putQueue, putRun, replaceTags, sameRepositories } from './runsState.ts';

/** What the connection reads at the moment of an event, not when it was opened. */
export interface RunsRefs {
  opened: { current: string | null };
  extra: { current: Map<string, RunView> };
  home: { current: string | null };
  wanted: { current: string | null };
}

interface Connection {
  api: Api;
  set: RunsSetters;
  refs: RunsRefs;
  closed: () => boolean;
}

/** Fetches the opened run again when only the by-id copy of it exists. */
function refreshOpened({ api, set, refs, closed }: Connection, listed: RunView[]): void {
  const id = refs.opened.current;
  if (id === null || !refs.extra.current.has(id) || listed.some((run) => run.id === id)) return;
  api
    .run(id)
    .then((run) => {
      if (!closed()) set.setExtra((current) => putRun(current, run));
    })
    .catch(() => {
      // the previous copy stays
    });
}

async function loadQueue({ api, set, closed }: Connection): Promise<void> {
  try {
    const view = await api.queue();
    if (closed()) return;
    set.setHome(view.repository);
    set.setQueues((current) => putQueue(current, view));
  } catch {
    // the queue stays as it was
  }
}

async function loadTags({ api, set, refs, closed }: Connection): Promise<void> {
  const catalog = await api.tags();
  if (closed()) return;
  set.setTags((current) => replaceTags(current, catalog, refs.home.current));
  const chosen = refs.wanted.current;
  if (chosen !== null && chosen !== refs.home.current) {
    const more = await api.forRepository(chosen).tags();
    if (closed()) return;
    set.setTags((current) => replaceTags(current, more, chosen));
  }
}

async function poll(connection: Connection): Promise<void> {
  const { api, set, closed } = connection;
  try {
    const list = await api.runs();
    if (closed()) return;
    set.setRuns((current) => mergeRuns(current, list));
    set.setLoaded(true);
    refreshOpened(connection, list);
    const known = await api.repositories();
    if (closed()) return;
    set.setRegistry((current) => sameRepositories(current, known));
    await loadTags(connection);
  } catch {
    // the server is unreachable; keep the last known state
  }
  await loadQueue(connection);
}

/** Opens the event stream; returns the function that closes it. */
export function connectRuns(
  api: Api,
  openStream: EventSourceFactory,
  set: RunsSetters,
  refs: RunsRefs,
): () => void {
  let closed = false;
  const connection: Connection = { api, set, refs, closed: () => closed };
  void loadQueue(connection);
  const fallback = createFallback(
    () => poll(connection),
    () => set.setConnection('polling'),
    connection.closed,
  );
  const source = openStream('/api/events');
  listen(source, fallback, {
    live: () => set.setConnection('live'),
    event: (event) => applyEvent(event, set, (list) => refreshOpened(connection, list)),
    broken: () =>
      set.setConnection((current) => (current === 'polling' ? current : 'reconnecting')),
  });
  return () => {
    closed = true;
    fallback.stop();
    source.close();
  };
}
