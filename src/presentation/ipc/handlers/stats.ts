import type { StatsClearView } from '../contract/responses/stats.ts';
import { statsView } from '../views/stats.ts';
import type { HandlerTable } from './types.ts';

/** The usage statistics: the report and the clearing of a project. */
export const statsHandlers = {
  stats_report: async (params, { services }) =>
    statsView(
      await services.stats.report.report({
        ...(params.since === undefined ? {} : { since: params.since }),
        ...(params.until === undefined ? {} : { until: params.until }),
        ...(params.repository === undefined ? {} : { repository: params.repository }),
      }),
    ),
  stats_clear: async (params, { services }): Promise<StatsClearView> => {
    // A project that left the registry may still have records: its path stands as written.
    const repository = await services.registry
      .resolve(params.repository)
      .catch(() => params.repository);
    return { removed: services.stats.ledger.clear(repository) };
  },
} satisfies Partial<HandlerTable>;
