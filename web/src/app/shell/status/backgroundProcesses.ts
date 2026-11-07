import { useCallback, useEffect, useRef, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { Connection } from '../../../shared/api/stream.ts';
import type { StreamedProcesses } from '../../../shared/api/runs/runsState.ts';
import type { BackgroundProcessView } from '../../../shared/api/types.ts';

/** How often the list of background processes is asked for while the page is visible. */
export const PROCESS_POLL_MS = 3_000;

export interface BackgroundProcesses {
  /** `null` until the first answer. */
  processes: BackgroundProcessView[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Background processes of the daemon: the event stream brings them; the list is asked for once
 * on mount and then repeatedly only while the stream is down or has sent none (an older daemon).
 * Asking stops while the page is hidden.
 */
export function useBackgroundProcesses(
  api: Api,
  streamed: StreamedProcesses | null = null,
  connection: Connection = 'reconnecting',
): BackgroundProcesses {
  const [processes, setProcesses] = useState<BackgroundProcessView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const askedOnce = useRef(false);
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
    if (!streamed) return;
    if (streamed.processes) {
      setProcesses(streamed.processes);
      setError(null);
    } else if (streamed.error) {
      setError(streamed.error);
    }
  }, [streamed]);
  const polling = connection !== 'live' || streamed === null;
  useEffect(() => {
    live.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      if (!askedOnce.current) {
        askedOnce.current = true;
        void refresh();
      } else if (polling) void refresh();
      if (polling) timer = setInterval(() => void refresh(), PROCESS_POLL_MS);
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
  }, [refresh, polling]);
  return { processes, error, refresh };
}

/** The processes of one task: a group of a run, or the run itself when the process has no group. */
export interface ProcessTask {
  key: string;
  owner: BackgroundProcessView['owner'];
  processes: BackgroundProcessView[];
}

/** Splits processes into tasks, in order of first appearance; the order inside a task is kept. */
export function groupProcessesByTask(processes: readonly BackgroundProcessView[]): ProcessTask[] {
  const tasks = new Map<string, ProcessTask>();
  for (const process of processes) {
    const key = JSON.stringify([process.owner.runId, process.owner.group]);
    const task = tasks.get(key);
    if (task) task.processes.push(process);
    else tasks.set(key, { key, owner: process.owner, processes: [process] });
  }
  return [...tasks.values()];
}
