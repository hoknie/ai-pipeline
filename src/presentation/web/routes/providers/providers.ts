import { z } from 'zod';
import type { ConfigEditResult } from '../../../ipc/contract/index.ts';
import { panel } from '../../errors.ts';
import { editReply, entryId, levelParam, parseBody } from '../../http.ts';
import { segment, type Route, type RouteKit } from '../types.ts';

const writeBody = z.object({
  value: z.record(z.string(), z.unknown()),
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

/** Providers of the registry: the list with status, the models of a provider, writing and deleting. */
export function providerRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/config\/providers$/,
      handle: (_match, _body, repository) => call('config_providers', { repository }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/config/providers/${segment}/models$`),
      handle: ([provider], _body, repository, query) =>
        call('provider_models', {
          repository,
          provider: entryId(provider),
          refresh: query.get('refresh') === '1',
        }),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/providers/${segment}$`),
      handle: async ([id], body, repository) => {
        const { value, revision, level } = parseBody(writeBody, body);
        return editReply(
          (await call('config_write', {
            repository,
            kind: 'provider',
            id: entryId(id),
            value,
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/api/config/providers/${segment}$`),
      handle: async ([id], body, repository) => {
        const { revision, level } = body as { revision?: string; level?: 'project' | 'global' };
        if (!revision) throw panel('invalid', 'revision is required');
        return editReply(
          (await call('config_delete', {
            repository,
            kind: 'provider',
            id: entryId(id),
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
  ];
}
