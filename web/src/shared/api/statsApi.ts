import type { StatsClearView, StatsReportView } from './types.ts';
import { call } from './http.ts';

/** What a report covers; no field means all time and all projects. Moments are whole milliseconds. */
export interface StatsQuery {
  since?: number;
  until?: number;
  repository?: string;
}

export interface StatsApi {
  /** The statistics report of the daemon. */
  statsReport(query?: StatsQuery): Promise<StatsReportView>;
  /** Removes the statistics of one project; the runs stay. */
  statsClear(repository: string): Promise<StatsClearView>;
}

export function statsApi(): StatsApi {
  return {
    statsReport: (query = {}) => {
      const params = new URLSearchParams();
      if (query.since !== undefined) params.set('since', String(query.since));
      if (query.until !== undefined) params.set('until', String(query.until));
      if (query.repository) params.set('repository', query.repository);
      const search = params.toString();
      return call(`/api/stats${search ? `?${search}` : ''}`);
    },
    statsClear: (repository) =>
      call(`/api/stats?repository=${encodeURIComponent(repository)}`, { method: 'DELETE' }),
  };
}
