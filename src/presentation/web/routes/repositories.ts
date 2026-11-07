import { isAbsolute } from 'node:path';

import { z } from 'zod';

import { panel } from '../errors.ts';
import { absoluteRepository, json, parseBody, readJson } from '../http.ts';
import type { RawRoute, RouteKit } from './types.ts';

export function repositoriesRoute({ call }: RouteKit): RawRoute {
  return {
    pattern: /^\/api\/repositories$/,
    async handle({ incoming, response, url, verb }) {
      if (verb === 'GET') return json(response, 200, await call('repositories', {}));
      if (verb === 'POST') {
        const { path } = parseBody(z.object({ path: z.string().min(1) }), await readJson(incoming));
        if (!isAbsolute(path)) throw panel('invalid', 'path must be an absolute path');
        return json(response, 200, await call('repository_add', { path }));
      }
      if (verb === 'DELETE') {
        const path = absoluteRepository(url.searchParams.get('repository'));
        return json(response, 200, await call('repository_remove', { path }));
      }
      throw panel('method_not_allowed', 'method not allowed');
    },
  };
}
