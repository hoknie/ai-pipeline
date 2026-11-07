import { z } from 'zod';
import { type ParamsOf } from '../../ipc/contract/index.ts';
import { parseBody } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

/** Fields of a queue request body; the repository comes from the query string, never the body. */
const queueBody = (body: unknown) => parseBody(z.record(z.string(), z.unknown()), body);

export function queueRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/queue$/,
      handle: (_match, _body, repository) => call('queue', { repository }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/queue\/items$/,
      handle: async (_, body, repository) =>
        call('queue_add', {
          ...queueBody(body),
          repository,
        } as ParamsOf<'queue_add'>),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/queue/items/${segment}$`),
      handle: async ([item], body, repository) =>
        call('queue_edit', {
          ...queueBody(body),
          item: item ?? '',
          repository,
        } as ParamsOf<'queue_edit'>),
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
