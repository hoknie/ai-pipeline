import type { ParamsOf } from '../../../ipc/contract/index.ts';
import { panel } from '../../errors.ts';
import type { Route, RouteKit } from '../types.ts';

export function observerHistoryRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/observers\/history$/,
      handle: async (_match, body) => {
        const params = body as ParamsOf<'observers_history'>;
        try {
          return await call('observers_history', params);
        } catch (error) {
          throw panel('invalid', error instanceof Error ? error.message : 'invalid history query');
        }
      },
    },
  ];
}
