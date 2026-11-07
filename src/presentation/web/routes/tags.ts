import { z } from 'zod';
import { parseBody } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

const tagName = z.string().trim().min(1);

const tagAddBody = z.object({ name: tagName, color: z.string().optional() });

const tagEditBody = z
  .object({ tag: tagName, name: tagName.optional(), color: z.string().optional() })
  .refine((body) => body.name !== undefined || body.color !== undefined, {
    message: 'pass a new name or a new color',
  });

const tagRemoveBody = z.object({ tag: tagName });

const runTagsBody = z
  .object({ add: z.array(tagName).max(20).optional(), remove: z.array(tagName).max(20).optional() })
  .refine((body) => (body.add?.length ?? 0) + (body.remove?.length ?? 0) > 0, {
    message: 'pass tags to add or remove',
  });

export function tagsRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/tags$/,
      handle: (_match, _body, repository) => call('tags', { repository }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tags$/,
      handle: async (_, body, repository) =>
        call('tag_add', { repository, ...parseBody(tagAddBody, body) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tags\/edit$/,
      handle: async (_, body, repository) =>
        call('tag_edit', { repository, ...parseBody(tagEditBody, body) }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tags\/remove$/,
      handle: async (_, body, repository) =>
        call('tag_remove', { repository, ...parseBody(tagRemoveBody, body) }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/tags$`),
      handle: async ([runId], body) =>
        call('run_tags', { runId: runId ?? '', ...parseBody(runTagsBody, body) }),
    },
  ];
}
