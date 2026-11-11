import { useCallback, useEffect, useRef, useState } from 'react';

import type { Api } from '../../shared/api/api.ts';
import type { RunView, StatsReportView } from '../../shared/api/types.ts';
import type { StatsPeriodId } from '../../shared/lib/nav/route.ts';

import { periodSince } from './statsView.ts';

/** The least time between two requests the events of runs cause. */
export const REFETCH_MS = 5000;

/** What changes when an attempt is saved: the state, the counts and the usage of the runs. */
export function runsSignature(runs: readonly RunView[]): string {
  return runs
    .map((run) => `${run.id}:${run.state}:${run.counts}:${JSON.stringify(run.usage)}`)
    .join('|');
}

export interface StatsState {
  report: StatsReportView | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * The report of the period and the project. An answer to an outdated request never replaces the
 * answer to a newer one; the report is read again after a change of the runs, at most once in
 * `REFETCH_MS`.
 */
export function useStatsReport(
  api: Api,
  period: StatsPeriodId,
  repository: string | null,
  runs: readonly RunView[],
): StatsState {
  const [report, setReport] = useState<StatsReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const lastAt = useRef(0);

  const load = useCallback(
    (fresh: boolean) => {
      latest.current += 1;
      const id = latest.current;
      lastAt.current = Date.now();
      if (fresh) setLoading(true);
      api
        .statsReport({
          since: periodSince(period, Date.now()),
          ...(repository === null ? {} : { repository }),
        })
        .then((next) => {
          if (id !== latest.current) return;
          setReport(next);
          setError(null);
          setLoading(false);
        })
        .catch((failure: unknown) => {
          if (id !== latest.current) return;
          setError(failure instanceof Error ? failure.message : String(failure));
          setLoading(false);
        });
    },
    [api, period, repository],
  );

  useEffect(() => {
    setReport(null);
    load(true);
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const signature = runsSignature(runs);
  const seen = useRef(signature);
  useEffect(() => {
    if (seen.current === signature) return undefined;
    seen.current = signature;
    const wait = Math.max(0, lastAt.current + REFETCH_MS - Date.now());
    const timer = setTimeout(() => load(false), wait);
    return () => clearTimeout(timer);
  }, [signature, load]);

  return { report, error, loading, reload: () => load(true) };
}
