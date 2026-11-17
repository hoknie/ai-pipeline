import type { Api } from '../../../shared/api/api.ts';

/** What a shared resource holds now. */
export interface SharedState<V> {
  value: V | null;
  failure: string | null;
  loading: boolean;
}

export const IDLE: SharedState<never> = { value: null, failure: null, loading: false };

interface Entry<V> {
  api: Api;
  state: SharedState<V>;
  listeners: Set<() => void>;
  pending: Promise<void> | null;
  fetchedAt: number;
}

export interface SharedStore<V> {
  /** Starts watching a key; the first watcher creates the entry (and asks, when `eager`). */
  subscribe(key: string, api: Api, listener: () => void, eager: boolean): () => void;
  read(key: string): SharedState<V>;
  /** Asks again (`refresh` for the daemon too); the request in flight is shared unless `refresh`. */
  reload(key: string, refresh?: boolean): Promise<void>;
  /** When the key was fetched last (ms); 0 when never. */
  fetchedAt(key: string): number;
}

/**
 * One request per key for all the components that watch it. An entry lives while someone watches
 * it, so a new page never sees the answer of an older one.
 */
export function createShared<V>(
  load: (api: Api, key: string, refresh: boolean) => Promise<V>,
): SharedStore<V> {
  const entries = new Map<string, Entry<V>>();
  const notify = (entry: Entry<V>) => entry.listeners.forEach((listener) => listener());

  const reload = (key: string, refresh = false): Promise<void> => {
    const entry = entries.get(key);
    if (!entry) return Promise.resolve();
    if (entry.pending && !refresh) return entry.pending;
    entry.state = { ...entry.state, loading: true };
    notify(entry);
    const pending = load(entry.api, key, refresh)
      .then(
        (value) => {
          entry.state = { value, failure: null, loading: false };
        },
        (error: Error) => {
          entry.state = { value: entry.state.value, failure: error.message, loading: false };
        },
      )
      .finally(() => {
        if (entry.pending === pending) entry.pending = null;
        entry.fetchedAt = Date.now();
        notify(entry);
      });
    entry.pending = pending;
    return pending;
  };

  return {
    subscribe(key, api, listener, eager) {
      let entry = entries.get(key);
      const created = entry === undefined;
      if (!entry) {
        entry = { api, state: IDLE, listeners: new Set(), pending: null, fetchedAt: 0 };
        entries.set(key, entry);
      }
      entry.listeners.add(listener);
      if (created && eager) void reload(key);
      const mine = entry;
      return () => {
        mine.listeners.delete(listener);
        if (mine.listeners.size === 0 && entries.get(key) === mine) entries.delete(key);
      };
    },
    read: (key) => entries.get(key)?.state ?? IDLE,
    reload,
    fetchedAt: (key) => entries.get(key)?.fetchedAt ?? 0,
  };
}
