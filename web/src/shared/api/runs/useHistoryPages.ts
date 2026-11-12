import { useCallback, useMemo, useRef, useState } from 'react';

import type { Api } from '../api.ts';
import type { RunView } from '../types.ts';
import { putRun, type HistoryState } from './runsState.ts';

/** Where one list stands: the cursor of its next page (undefined: none loaded yet) and the load. */
interface ListState {
  cursor: string | null | undefined;
  loading: boolean;
  error: string | null;
}

const FRESH: ListState = { cursor: undefined, loading: false, error: null };

/**
 * Loads the finished runs the stream does not carry, page by page. Every list has its own cursor,
 * error and load flag: the list of one repository (`repository` is its path), or all of them
 * (null). Loaded runs stay when the list changes; `undefined` means the list is not known yet,
 * nothing is loaded then.
 */
export function useHistoryPages(
  api: Api,
  setHistory: (update: (current: Map<string, RunView>) => Map<string, RunView>) => void,
  repository: string | null | undefined,
): HistoryState {
  const [lists, setLists] = useState<ReadonlyMap<string, ListState>>(new Map());
  const listsRef = useRef(lists);
  const key = repository ?? '';
  const patch = useCallback((id: string, change: Partial<ListState>) => {
    const next = new Map(listsRef.current);
    next.set(id, { ...(next.get(id) ?? FRESH), ...change });
    listsRef.current = next;
    setLists(next);
  }, []);
  const loadMore = useCallback(() => {
    if (repository === undefined) return;
    const list = listsRef.current.get(key) ?? FRESH;
    if (list.loading || list.cursor === null) return;
    patch(key, { loading: true, error: null });
    api
      .finishedRuns(list.cursor, repository ?? undefined)
      .then((page) => {
        setHistory((current) => page.runs.reduce((map, run) => putRun(map, run), current));
        patch(key, { cursor: page.next, loading: false });
      })
      .catch((error: unknown) => {
        patch(key, {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [api, setHistory, repository, key, patch]);
  const current = lists.get(key) ?? FRESH;
  return useMemo(
    () => ({
      // An unknown list is not idle: the marker appears only once the list is known.
      loading: current.loading || repository === undefined,
      error: current.error,
      done: current.cursor === null,
      loadMore,
    }),
    [current, loadMore, repository],
  );
}
