import { useCallback, useMemo, useRef, useState } from 'react';

import type { Api } from '../api.ts';
import type { RunView } from '../types.ts';
import { putRun, type HistoryState } from './runsState.ts';

/** Loads the finished runs the stream does not carry, page by page. */
export function useHistoryPages(
  api: Api,
  setHistory: (update: (current: Map<string, RunView>) => Map<string, RunView>) => void,
): HistoryState {
  // The cursor of the next page (undefined: none loaded yet).
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [paging, setPaging] = useState(false);
  const [pagingError, setPagingError] = useState<string | null>(null);
  const pagingRef = useRef(false);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const loadMore = useCallback(() => {
    if (pagingRef.current || cursorRef.current === null) return;
    pagingRef.current = true;
    setPaging(true);
    setPagingError(null);
    api
      .finishedRuns(cursorRef.current)
      .then((page) => {
        setHistory((current) => page.runs.reduce((map, run) => putRun(map, run), current));
        cursorRef.current = page.next;
        setCursor(page.next);
      })
      .catch((error: unknown) => {
        setPagingError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        pagingRef.current = false;
        setPaging(false);
      });
  }, [api, setHistory]);
  return useMemo(
    () => ({ loading: paging, error: pagingError, done: cursor === null, loadMore }),
    [paging, pagingError, cursor, loadMore],
  );
}
