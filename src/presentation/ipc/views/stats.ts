import type { StatsReport } from '../../../feature/stats/types/index.ts';
import type { StatsReportView } from '../contract/responses/stats.ts';

/** Email and name of a user as of now; null when the account is gone. */
export type AuthorLookup = (id: string) => { email: string; name: string | null } | null;

/** The report as the clients get it; the rows of `byAuthor` get the email and the name of the user. */
export function statsView(report: StatsReport, authors?: AuthorLookup): StatsReportView {
  if (report.byAuthor === undefined || authors === undefined) return report;
  return {
    ...report,
    byAuthor: report.byAuthor.map((row) => {
      const user = authors(row.key);
      return user === null ? row : { ...row, name: user.name ?? user.email, email: user.email };
    }),
  };
}
