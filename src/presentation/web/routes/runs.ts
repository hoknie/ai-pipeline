import { z } from 'zod';
import { RUN_TITLE_LIMIT } from '../../../feature/agents/types/index.ts';
import { parseBody } from '../http.ts';
import { segment, type Route, type RouteKit } from './types.ts';

const skipBody = z.object({ step: z.string().trim().min(1), skip: z.boolean() });

const applyBody = z.object({
  groups: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

const markDeliveredBody = z.object({ groups: z.array(z.string().min(1)).optional() });

const runObserverBody = z.object({ enabled: z.boolean() });

const runTitleBody = z.object({ title: z.string().trim().min(1).max(RUN_TITLE_LIMIT) });

export function runsRoutes({ call }: RouteKit): Route[] {
  return [
    { method: 'GET', pattern: /^\/api\/runs$/, handle: () => call('status', {}) },
    {
      method: 'GET',
      pattern: /^\/api\/finished-runs$/,
      handle: (_match, body) =>
        call('finished_runs', body as { limit: number; before?: string; repository?: string }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}$`),
      handle: ([runId]) => call('status', { runId: runId ?? '' }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/observer$`),
      handle: async ([runId], body) =>
        call('run_observer', { runId: runId ?? '', ...parseBody(runObserverBody, body) }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/cancel$`),
      handle: ([runId]) => call('cancel', { runId: runId ?? '' }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/pause$`),
      handle: ([runId]) => call('run_pause', { runId: runId ?? '' }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/skip$`),
      handle: async ([runId], body) => {
        const { step, skip } = parseBody(skipBody, body);
        return call('run_skip', { runId: runId ?? '', step, skip });
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/apply$`),
      handle: async ([runId], body) => {
        const { groups, force } = parseBody(applyBody, body);
        return call('apply', {
          runId: runId ?? '',
          ...(groups ? { groups } : {}),
          ...(force ? { force: true } : {}),
        });
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/delivered$`),
      handle: async ([runId], body) => {
        const { groups } = parseBody(markDeliveredBody, body);
        return call('run_mark_delivered', { runId: runId ?? '', ...(groups ? { groups } : {}) });
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/title$`),
      handle: async ([runId], body) =>
        call('run_title', { runId: runId ?? '', ...parseBody(runTitleBody, body) }),
    },
  ];
}
