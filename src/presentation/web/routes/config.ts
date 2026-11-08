import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { type ConfigEditResult, type PipelinesImportResult } from '../../ipc/contract/index.ts';
import { panel } from '../errors.ts';
import { Reply, editReply, entryId, parseBody, levelParam } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

const previewBody = z.object({
  value: z.record(z.string(), z.unknown()),
  level: levelParam.optional(),
});

const writeBody = z.object({
  value: z.record(z.string(), z.unknown()),
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

const pipelineImportBody = z.object({
  source: z.string().refine((value) => isAbsolute(value), {
    message: 'source must be an absolute path',
  }),
  ids: z.array(z.string().min(1)).min(1),
});

function configReadRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/pipelines$/,
      handle: (_match, _body, repository) => call('pipelines', { repository }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/system-stages$/,
      handle: (_match, _body, repository) => call('system_stages', { repository }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/config$/,
      handle: (_match, _body, repository) => call('config', { repository }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/config\/catalog$/,
      handle: (_match, _body, repository) => call('config_catalog', { repository }),
    },
  ];
}

function configWriteRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/specialists/${segment}$`),
      handle: async ([id], body, repository) => {
        const { value, revision, level } = parseBody(writeBody, body);
        return editReply(
          (await call('config_write', {
            repository,
            kind: 'specialist',
            id: entryId(id),
            value,
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/pipelines\/import$/,
      handle: async (_match, body, repository) => {
        const result = (await call('pipelines_import', {
          repository,
          ...parseBody(pipelineImportBody, body),
        })) as PipelinesImportResult;
        if (result.ok) return new Reply(200, result);
        if (result.reason === 'conflict') {
          return new Reply(409, { error: result.message, ids: result.ids ?? [] });
        }
        return new Reply(422, { errors: result.errors, references: [] });
      },
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/api/config/(specialists|pipelines|actions|chains)/${segment}$`),
      handle: async ([section, id], body, repository) => {
        const { revision, level } = body as { revision?: string; level?: 'project' | 'global' };
        if (!revision) throw panel('invalid', 'revision is required');
        return editReply(
          (await call('config_delete', {
            repository,
            kind:
              section === 'pipelines'
                ? 'pipeline'
                : section === 'actions'
                  ? 'action'
                  : section === 'chains'
                    ? 'chain'
                    : 'specialist',
            id: entryId(id),
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
  ];
}

function configImportRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/pipelines/${segment}$`),
      handle: async ([id], body, repository) => {
        const { value, revision, level } = parseBody(writeBody, body);
        return editReply(
          (await call('config_write', {
            repository,
            kind: 'pipeline',
            id: entryId(id),
            value,
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/actions/${segment}$`),
      handle: async ([id], body, repository) => {
        const { value, revision, level } = parseBody(writeBody, body);
        return editReply(
          (await call('config_write', {
            repository,
            kind: 'action',
            id: entryId(id),
            value,
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/chains/${segment}$`),
      handle: async ([id], body, repository) => {
        const { value, revision, level } = parseBody(writeBody, body);
        return editReply(
          (await call('config_write', {
            repository,
            kind: 'chain',
            id: entryId(id),
            value,
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/config/pipelines/${segment}/preview$`),
      handle: async ([id], body, repository) =>
        call('config_preview', {
          repository,
          kind: 'pipeline',
          id: entryId(id),
          value: parseBody(previewBody, body).value,
          level: parseBody(previewBody, body).level,
        }),
    },
  ];
}

export function configRoutes(kit: RouteKit): Route[] {
  return [...configReadRoutes(kit), ...configWriteRoutes(kit), ...configImportRoutes(kit)];
}
