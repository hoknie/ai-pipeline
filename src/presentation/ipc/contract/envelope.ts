import { INCIDENT_KINDS } from '../../../feature/runs/types/index.ts';
import { agentsRequests } from './agents.ts';
import { artifactsRequests } from './artifacts.ts';
import { configRequests } from './config.ts';
import { groupsRequests } from './groups.ts';
import { observersRequests } from './observers.ts';
import { networkStatusSchema, panelRequests } from './panel.ts';
import { processesRequests } from './processes.ts';
import { queueRequests } from './queue.ts';
import { repositoriesRequests } from './repositories.ts';
import { runsRequests } from './runs.ts';
import { tagsRequests } from './tags.ts';
import { z } from 'zod';

export const requestSchema = z.discriminatedUnion('method', [
  ...runsRequests,
  ...groupsRequests,
  ...artifactsRequests,
  ...queueRequests,
  ...repositoriesRequests,
  ...tagsRequests,
  ...observersRequests,
  ...configRequests,
  ...processesRequests,
  ...agentsRequests,
  ...panelRequests,
]);

export type Request = z.infer<typeof requestSchema>;

export type Method = Request['method'];

export type ParamsOf<M extends Method> = Extract<Request, { method: M }>['params'];

export const envelopeSchema = z.object({ id: z.number().int() }).loose();

export type Response =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export const responseSchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string() }),
]);

export function parseRequest(
  line: string,
): { id: number; request: Request } | { id: number; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { id: -1, error: 'invalid JSON' };
  }
  const envelope = envelopeSchema.safeParse(value);
  const id = envelope.success ? envelope.data.id : -1;
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return { id, error: z.prettifyError(parsed.error) };
  return { id, request: parsed.data };
}

export const streamEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('snapshot'),
    seq: z.number().int(),
    runs: z.array(z.looseObject({ id: z.string() })),
    queues: z.array(z.looseObject({ repository: z.string() })).optional(),
    repositories: z.array(z.looseObject({ path: z.string() })).optional(),
    tags: z.array(z.looseObject({ id: z.string() })).optional(),
  }),
  z.object({
    event: z.literal('tags'),
    seq: z.number().int(),
    repository: z.string().optional(),
    tags: z.array(z.looseObject({ id: z.string() })),
  }),
  z.object({
    event: z.literal('repositories'),
    seq: z.number().int(),
    repositories: z.array(z.looseObject({ path: z.string() })),
  }),
  z.object({
    event: z.literal('queue'),
    seq: z.number().int(),
    queue: z.looseObject({ repository: z.string() }),
  }),
  z.object({
    event: z.literal('run'),
    seq: z.number().int(),
    run: z.looseObject({ id: z.string() }),
  }),
  z.object({ event: z.literal('observers'), seq: z.number().int(), observers: z.looseObject({}) }),
  z.object({
    event: z.literal('incident'),
    seq: z.number().int(),
    runId: z.string(),
    repository: z.string(),
    incident: z.object({
      key: z.string(),
      kind: z.enum(INCIDENT_KINDS),
      group: z.string(),
      detail: z.string(),
    }),
  }),
  z.object({ event: z.literal('network'), seq: z.number().int(), network: networkStatusSchema }),
  z.object({
    event: z.literal('processes'),
    seq: z.number().int(),
    processes: z.array(z.looseObject({ pid: z.number() })).optional(),
    error: z.string().optional(),
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;

export type BackgroundProcessesStreamEvent = Extract<StreamEvent, { event: 'processes' }>;
