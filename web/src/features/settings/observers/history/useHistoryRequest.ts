import { useCallback, useRef, useState } from 'react';
import type { Api } from '../../../../shared/api/api.ts';
import type {
  ObserverHistoryPage,
  ObserverHistoryQuery,
} from '../../../../shared/api/observerHistoryApi.ts';

export function useHistoryRequest(api: Api) {
  const [page, setPage] = useState<ObserverHistoryPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  const request = useCallback(
    async (query: ObserverHistoryQuery, cursor: string | undefined, commit: () => void) => {
      const current = ++generation.current;
      setBusy(true);
      setError(null);
      try {
        const result = await api.observerHistory({ ...query, cursor });
        if (generation.current === current) {
          commit();
          setPage(result);
        }
      } catch (reason) {
        if (generation.current === current) setError(reason);
      } finally {
        if (generation.current === current) setBusy(false);
      }
    },
    [api],
  );
  return { page, setPage, busy, error, request, generation };
}
