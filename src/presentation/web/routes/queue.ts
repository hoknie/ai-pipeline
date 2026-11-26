import { z } from 'zod';
import { type ParamsOf } from '../../ipc/contract/index.ts';
import { parseBody } from '../http.ts';
import { dropUploads, uploadSources } from '../uploads.ts';
import { segment, type Route, type RouteKit } from './types.ts';

/** Fields of a queue request body; the repository comes from the query string, never the body. */
const queueBody = (body: unknown) => parseBody(z.record(z.string(), z.unknown()), body);

/** The ends of `task_link` and `task_unlink`; the repository is optional and comes from the query too. */
const linkBody = (body: unknown, repository: string | undefined) => {
  const { source, kind, target } = parseBody(
    z.object({ source: z.string().min(1), kind: z.string().min(1), target: z.string().min(1) }),
    body,
  );
  return { source, kind, target, ...(repository ? { repository } : {}) };
};

/** `queue_add` with the uploads of the body turned into attachments; the used uploads go away. */
async function addTask(kit: RouteKit, body: unknown, repository: string): Promise<unknown> {
  const { uploads, ...fields } = queueBody(body);
  const attachments = uploads === undefined ? [] : uploadSources(kit, uploads);
  const result = await kit.call('queue_add', {
    ...fields,
    ...(attachments.length > 0 ? { attachments } : {}),
    repository,
  } as ParamsOf<'queue_add'>);
  dropUploads(kit, uploads);
  return result;
}

/** `queue_edit` with the uploads of the body attached; the used uploads go away. */
async function editTask(
  kit: RouteKit,
  item: string,
  body: unknown,
  repository: string,
): Promise<unknown> {
  const { uploads, ...fields } = queueBody(body);
  const attach = uploads === undefined ? [] : uploadSources(kit, uploads);
  const result = await kit.call('queue_edit', {
    ...fields,
    ...(attach.length > 0 ? { attach } : {}),
    item,
    repository,
  } as ParamsOf<'queue_edit'>);
  dropUploads(kit, uploads);
  return result;
}

/** Linking and unlinking two tasks. */
function linkRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/repository\/branches$/,
      handle: (_match, _body, repository, query) =>
        call('repository_branches', {
          repository,
          query: parseBody(z.string().max(256), query.get('query') ?? ''),
          exact:
            parseBody(z.enum(['true', 'false']).optional(), query.get('exact') ?? undefined) ===
            'true',
        }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tasks\/link$/,
      handle: (_match, body, repository) =>
        call('task_link', linkBody(body, repository) as ParamsOf<'task_link'>),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tasks\/unlink$/,
      handle: (_match, body, repository) =>
        call('task_unlink', linkBody(body, repository) as ParamsOf<'task_unlink'>),
    },
  ];
}

export function queueRoutes(kit: RouteKit): Route[] {
  const { call } = kit;
  return [
    {
      method: 'GET',
      pattern: /^\/api\/queue$/,
      handle: (_match, body, repository) =>
        call('queue', { ...(body as { author?: string }), repository }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/items$/,
      handle: (_, body, repository) => addTask(kit, body, repository),
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/projects$/,
      handle: (_, body) =>
        call('queue_add_projects', queueBody(body) as ParamsOf<'queue_add_projects'>),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/queue/items/${segment}$`),
      handle: ([item], body, repository) => editTask(kit, item ?? '', body, repository),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/queue/items/${segment}/remove$`),
      handle: ([item], _body, repository) => call('queue_remove', { item: item ?? '', repository }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/queue/items/${segment}/run$`),
      handle: ([item], _body, repository) =>
        call('queue_run_now', { item: item ?? '', repository }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/start$/,
      handle: async (_, body, repository) =>
        call('queue_start', {
          ...queueBody(body),
          repository,
        } as ParamsOf<'queue_start'>),
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/pause$/,
      handle: (_match, _body, repository) => call('queue_pause', { repository }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/return$/,
      handle: async (_, body, repository) => {
        const { run } = parseBody(z.object({ run: z.string().min(1) }), body);
        return call('queue_return', { runId: run, ...(repository ? { repository } : {}) });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/dismiss$/,
      handle: async (_, body, repository) => {
        const { run } = parseBody(z.object({ run: z.string().min(1) }), body);
        return call('queue_dismiss', { runId: run, ...(repository ? { repository } : {}) });
      },
    },
    ...linkRoutes(kit),
    {
      method: 'POST',
      pattern: /^\/api\/queue\/settings$/,
      handle: async (_, body, repository) =>
        call('queue_settings', {
          ...queueBody(body),
          repository,
        } as ParamsOf<'queue_settings'>),
    },
  ];
}
