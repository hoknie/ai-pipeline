import type { ParamsOf } from '../../../ipc/contract/index.ts';
import type { Route, RouteKit } from '../types.ts';

/** `GET /api/audit`: the journal of the audit for administrators (the daemon refuses the others). */
export function auditRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/audit$/,
      handle: (_match, body) => call('audit_list', body as ParamsOf<'audit_list'>),
    },
  ];
}
