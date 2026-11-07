import { z } from 'zod';
import { MESSAGE_TEXT_LIMIT } from '../../ipc/contract/index.ts';
import { parseBody } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

const answerBody = z.object({ answer: z.string().trim().min(1) });

const messageBody = z.object({
  seq: z.number().int().positive(),
  text: z.string().trim().min(1).max(MESSAGE_TEXT_LIMIT),
});

const retryBody = z.object({ refreshConfig: z.boolean().optional() });

export function groupsRoutes({ call }: RouteKit): Route[] {
  return [
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}$`),
      handle: ([runId, group], body) =>
        call('group', {
          runId: runId ?? '',
          group: group ?? '',
          tailLines: (body as { tail: number }).tail,
        }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/spec$`),
      handle: ([runId, group]) => call('group_spec', { runId: runId ?? '', group: group ?? '' }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/artifacts$`),
      handle: async ([runId, group]) => ({
        artifacts: await call('group_artifacts', { runId: runId ?? '', group: group ?? '' }),
      }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/transcript$`),
      handle: ([runId, group], body) =>
        call('transcript', {
          runId: runId ?? '',
          group: group ?? '',
          ...(body as { seq?: number; after?: number }),
        }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/diff$`),
      handle: ([runId, group], body) =>
        call('group_file_diff', {
          runId: runId ?? '',
          group: group ?? '',
          path: (body as { path: string }).path,
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/(cancel|retry)$`),
      handle: ([runId, group, action], body) => {
        if (action !== 'retry') return call('cancel', { runId: runId ?? '', group: group ?? '' });
        const { refreshConfig } = parseBody(retryBody, body);
        return call('retry', {
          runId: runId ?? '',
          group: group ?? '',
          ...(refreshConfig ? { refreshConfig: true } : {}),
        });
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/answer$`),
      handle: async ([runId, group], body) =>
        call('answer', {
          runId: runId ?? '',
          group: group ?? '',
          answer: parseBody(answerBody, body).answer,
        }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/groups/${segment}/message$`),
      handle: async ([runId, group], body) => {
        const { seq, text } = parseBody(messageBody, body);
        return call('message', { runId: runId ?? '', group: group ?? '', seq, text });
      },
    },
  ];
}
