import { useEffect, useRef, useState } from 'react';

import { ApiError, type Api } from '../api.ts';
import { putRun, type OpenedState } from './runsState.ts';
import type { RunsSetters } from './streamEvents.ts';
import type { RunsState } from './useRunsStore.ts';

/** Fetches the run of the address by id when the list lacks it, and says where it came from. */
export function useOpenedRun(
  api: Api,
  { runs, extra, history, loaded }: RunsState,
  setExtra: RunsSetters['setExtra'],
  opened: string | null,
  onError: (message: string) => void,
): OpenedState {
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const listed = opened !== null && runs.has(opened);
  const known = opened !== null && (listed || extra.has(opened) || history.has(opened));
  const gone = opened !== null && unknown.has(opened);
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
  }, [api, loaded, opened, known, gone, setExtra]);
  return opened === null ? null : known ? 'listed' : gone ? 'missing' : loaded ? 'loading' : null;
}
