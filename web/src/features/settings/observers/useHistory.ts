import { useEffect, useRef, useState } from 'react';
import type { Api } from '../../../shared/api/api.ts';
import type { ObserverHistoryQuery } from '../../../shared/api/observerHistoryApi.ts';
import { useHistoryRequest } from './history/useHistoryRequest.ts';

type RequestCall = {
  query: ObserverHistoryQuery;
  cursor: string | undefined;
  commit: () => void;
};

const RESET_FILTERS: Partial<ObserverHistoryQuery> = {
  repository: undefined,
  runtime: undefined,
  model: undefined,
  result: undefined,
  from: undefined,
  to: undefined,
};

export function useHistory(api: Api) {
  const [filters, setFilters] = useState<ObserverHistoryQuery>({ limit: 20 });
  const [cursor, setCursor] = useState<string | undefined>();
  const [stack, setStack] = useState<Array<string | undefined>>([]);
  const { page, setPage, busy, error, request, generation } = useHistoryRequest(api);
  const lastRequest = useRef<RequestCall | null>(null);

  const runRequest = (
    query: ObserverHistoryQuery,
    targetCursor: string | undefined,
    commit: () => void,
  ) => {
    lastRequest.current = { query, cursor: targetCursor, commit };
    void request(query, targetCursor, commit);
  };

  useEffect(() => {
    runRequest(filters, undefined, () => {
      setCursor(undefined);
      setStack([]);
    });
    return () => {
      generation.current += 1;
    };
  }, [request]);

  const update = (patch: Partial<ObserverHistoryQuery>) => {
    const next = { ...filters, ...patch, cursor: undefined };
    setFilters(next);
    setPage(null);
    setStack([]);
    setCursor(undefined);
    runRequest(next, undefined, () => {});
  };

  const next = () => {
    if (!page?.nextCursor || busy) return;
    const target = page.nextCursor;
    runRequest(filters, target, () => {
      setStack((s) => [...s, cursor]);
      setCursor(target);
    });
  };

  const back = () => {
    if (!stack.length || busy) return;
    const prior = stack[stack.length - 1];
    runRequest(filters, prior, () => {
      setStack((s) => s.slice(0, -1));
      setCursor(prior);
    });
  };

  return {
    filters,
    page,
    busy,
    error,
    canBack: stack.length > 0,
    pageNumber: stack.length + 1,
    update,
    next,
    back,
    refresh: () => {
      setPage(null);
      setCursor(undefined);
      setStack([]);
      runRequest(filters, undefined, () => {});
    },
    retry: () => {
      if (lastRequest.current) {
        const { query, cursor: targetCursor, commit } = lastRequest.current;
        void request(query, targetCursor, commit);
      }
    },
    reset: () => update(RESET_FILTERS),
  };
}
