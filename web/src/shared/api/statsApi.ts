import type { StatsClearView, StatsReportView } from './types.ts';
import { call } from './http.ts';

export type StatsBucket = '6h' | 'day' | 'week';
export type StatsBucketRequest = 'auto' | StatsBucket;

/** What a report covers; no field means all time and all projects. Moments are whole milliseconds. */
export interface StatsQuery {
  since?: number;
  until?: number;
  repository?: string;
  bucket?: StatsBucketRequest;
  /** A user id or `me`; server mode only. */
  author?: string;
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
      if (query.bucket) params.set('bucket', query.bucket);
      if (query.author) params.set('author', query.author);
      const search = params.toString();
      return call(`/api/stats${search ? `?${search}` : ''}`);
    },
    statsClear: (repository) =>
      call(`/api/stats?repository=${encodeURIComponent(repository)}`, { method: 'DELETE' }),
  };
}
