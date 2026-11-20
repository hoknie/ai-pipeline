import type { Route, RouteKit } from '../types.ts';

/** `GET /api/access/me[?repository=<slug>]`: what the signed in user may do in a project. */
export function accessRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/access\/me$/,
      handle: (_match, _body, _repository, query) => {
        const repository = query.get('repository');
        return call('access_me', repository ? { repository } : {});
      },
    },
  ];
}
