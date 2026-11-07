import { panel } from '../errors.ts';
import { type Route, type RouteKit } from './types.ts';

export function processesRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/processes$/,
      handle: () => call('processes', {}),
    },
    {
      method: 'POST',
      pattern: /^\/api\/processes\/([^/]+)\/kill$/,
      handle: ([pid]) => {
        if (!/^\d+$/.test(pid ?? '')) throw panel('invalid', 'pid must be a positive integer');
        return call('process_kill', { pid: Number(pid) });
      },
    },
  ];
}
