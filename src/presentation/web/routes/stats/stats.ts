import type { ParamsOf } from '../../../ipc/contract/index.ts';
import { panel } from '../../errors.ts';
import type { Route, RouteKit } from '../types.ts';

/** `GET /api/stats` is the report of the daemon; `DELETE /api/stats?repository=` clears a project. */
export function statsRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/stats$/,
      handle: (_match, query) => call('stats_report', query as ParamsOf<'stats_report'>),
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/stats$/,
      handle: (_match, query) => {
        const { repository } = query as { repository?: string };
        if (repository === undefined) throw panel('invalid', 'repository is required');
        return call('stats_clear', { repository });
      },
    },
  ];
}
