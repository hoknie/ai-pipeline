import { useCallback, useEffect, useRef, useState } from 'react';

import type { Api } from './api.ts';
import type { BackgroundProcessView } from './types.ts';

/** How often the list of background processes is asked for while the page is visible. */
export const PROCESS_POLL_MS = 3_000;

export interface BackgroundProcesses {
  /** `null` until the first answer. */
  processes: BackgroundProcessView[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Polls the background processes of the daemon; stops while the page is hidden. */
export function useBackgroundProcesses(api: Api): BackgroundProcesses {
  const [processes, setProcesses] = useState<BackgroundProcessView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const view = await api.processes();
      if (!live.current) return;
      setProcesses(view.processes);
      setError(null);
    } catch (caught) {
      if (!live.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [api]);
  useEffect(() => {
    live.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      void refresh();
      timer = setInterval(() => void refresh(), PROCESS_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live.current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);
  return { processes, error, refresh };
}
