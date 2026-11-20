import type { StatsClearView } from '../contract/responses/stats.ts';
import { readableOf } from './access/visible.ts';
import { statsView } from '../views/stats.ts';
import type { HandlerTable } from './types.ts';

/** The usage statistics: the report and the clearing of a project. */
export const statsHandlers = {
  stats_report: async (params, context) => {
    const { services } = context;
    const readable = readableOf(context);
    return statsView(
      await services.stats.report.report({
        ...(readable.all
          ? {}
          : {
              only: services.registry
                .entries()
                .filter((entry) => readable.has(entry.path))
                .map((entry) => entry.path),
            }),
        ...(params.since === undefined ? {} : { since: params.since }),
        ...(params.until === undefined ? {} : { until: params.until }),
        ...(params.repository === undefined ? {} : { repository: params.repository }),
        ...(params.bucket === undefined ? {} : { bucket: params.bucket }),
      }),
    );
  },
  stats_clear: async (params, { services }): Promise<StatsClearView> => {
    // A project that left the registry may still have records: its path stands as written.
    const repository = await services.registry
      .resolve(params.repository)
      .catch(() => params.repository);
    return { removed: services.stats.ledger.clear(repository) };
  },
} satisfies Partial<HandlerTable>;
