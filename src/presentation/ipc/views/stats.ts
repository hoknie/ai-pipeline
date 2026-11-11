import type { StatsReport } from '../../../feature/stats/types/index.ts';
import type { StatsReportView } from '../contract/responses/stats.ts';

/** The report as the clients get it. */
export function statsView(report: StatsReport): StatsReportView {
  return report;
}
