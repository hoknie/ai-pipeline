import { isAbsolute } from 'node:path';

import { z } from 'zod';

import { panel } from '../errors.ts';
import { listDirectory } from '../panel/directories.ts';
import { absoluteRepository, json, parseBody, readJson } from '../http.ts';
import type { RawRoute, RouteKit } from './types.ts';

/** An absolute path, or one under the home directory written as `~` or `~/…`. */
const absolute = (field: string) =>
  z.string().refine((value) => isAbsolute(value) || value === '~' || value.startsWith('~/'), {
    message: `${field} must be an absolute path or start with ~/`,
  });

const name = z.string().trim().min(1).max(80);

const addBody = z.strictObject({
  path: absolute('path'),
  name: name.optional(),
  slug: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
});

const updateBody = z.strictObject({
  name: name.nullable().optional(),
  slug: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  color: z.string().min(1).nullable().optional(),
});

const moveBody = z.strictObject({ to: absolute('to') });

/** The registry of projects: list, add, change, move and remove. */
export function repositoriesRoute({ call }: RouteKit): RawRoute {
  return {
    pattern: /^\/api\/repositories(\/move)?$/,
    async handle({ incoming, response, url, verb, match }) {
      if (match[1] === '/move') {
        if (verb !== 'POST') throw panel('method_not_allowed', 'method not allowed');
        const path = absoluteRepository(url.searchParams.get('repository'));
        const { to } = parseBody(moveBody, await readJson(incoming));
        return json(response, 200, await call('repository_move', { path, to }));
      }
      if (verb === 'GET') return json(response, 200, await call('repositories', {}));
      if (verb === 'POST') {
        const body = parseBody(addBody, await readJson(incoming));
        return json(response, 200, await call('repository_add', body));
      }
      if (verb === 'PATCH') {
        const path = absoluteRepository(url.searchParams.get('repository'));
        const changes = parseBody(updateBody, await readJson(incoming));
        return json(response, 200, await call('repository_update', { path, ...changes }));
      }
      if (verb === 'DELETE') {
        const path = absoluteRepository(url.searchParams.get('repository'));
        return json(response, 200, await call('repository_remove', { path }));
      }
      throw panel('method_not_allowed', 'method not allowed');
    },
  };
}

/** `GET /api/directories?path=`: what the path picker shows; the panel's machine only. */
export function directoriesRoute(): RawRoute {
  return {
    pattern: /^\/api\/directories$/,
    async handle({ response, url, verb }) {
      if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
      return json(response, 200, listDirectory(url.searchParams.get('path')));
    },
  };
}
