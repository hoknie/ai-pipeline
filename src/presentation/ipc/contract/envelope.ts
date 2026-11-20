import { INCIDENT_KINDS } from '../../../feature/runs/types/index.ts';
import { accessRequests } from './access/access.ts';
import { agentsRequests } from './agents.ts';
import { artifactsRequests } from './artifacts.ts';
import { configRequests } from './config.ts';
import { groupsRequests } from './groups.ts';
import { auditRequests } from './identity/audit.ts';
import { identityRequests } from './identity/identity.ts';
import { integrationsRequests } from './integrations/integrations.ts';
import { observersRequests } from './observers.ts';
import { networkStatusSchema, panelRequests } from './panel.ts';
import { processesRequests } from './processes.ts';
import { queueRequests } from './queue.ts';
import { repositoriesRequests } from './repositories.ts';
import { runsRequests } from './runs.ts';
import { statsRequests } from './stats/stats.ts';
import { tagsRequests } from './tags.ts';
import { z } from 'zod';

export const requestSchema = z.discriminatedUnion('method', [
  ...runsRequests,
  ...groupsRequests,
  ...artifactsRequests,
  ...queueRequests,
  ...repositoriesRequests,
  ...integrationsRequests,
  ...tagsRequests,
  ...statsRequests,
  ...observersRequests,
  ...configRequests,
  ...processesRequests,
  ...agentsRequests,
  ...panelRequests,
  ...identityRequests,
  ...auditRequests,
  ...accessRequests,
]);

export type Request = z.infer<typeof requestSchema>;

export type Method = Request['method'];

export type ParamsOf<M extends Method> = Extract<Request, { method: M }>['params'];

export const envelopeSchema = z
  .object({ id: z.number().int(), actor: z.string().min(1).max(128).optional() })
  .loose();

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; kind?: string; code?: string };

export const responseSchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.number().int(),
    ok: z.literal(false),
    error: z.string(),
    kind: z.string().optional(),
    code: z.string().optional(),
  }),
]);

/** The longest request the daemon reads, in bytes; a longer one is cut off before it is parsed. */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/**
 * Every refusal of a request before and around its handler: a fixed code and a fixed text. Any
 * request may carry a secret in any field, whatever its method says, so no part of the input, of a
 * validation message or of a nested exception ever reaches the answer or the log.
 */
const IPC_ERRORS = {
  invalid_json: 'request is not valid JSON',
  request_too_large: 'request is too large',
  invalid_request: 'request has no valid id and method',
  unknown_method: 'unknown method',
  invalid_params: 'invalid parameters',
  internal: 'request failed',
} as const;

export type IpcErrorCode = keyof typeof IPC_ERRORS;

export function ipcError(code: IpcErrorCode): { error: string; code: IpcErrorCode } {
  return { error: IPC_ERRORS[code], code };
}

const METHODS = new Set<string>(requestSchema.options.map((option) => option.shape.method.value));

/** Names a failed request by what is known without quoting it. */
function failureCode(value: unknown): IpcErrorCode {
  const method = (value as { method?: unknown } | null)?.method;
  if (typeof value !== 'object' || value === null || typeof method !== 'string') {
    return 'invalid_request';
  }
  return METHODS.has(method) ? 'invalid_params' : 'unknown_method';
}

export function parseRequest(
  line: string,
):
  | { id: number; request: Request; actor?: string }
  | { id: number; error: string; code: IpcErrorCode } {
  // The second check of the size: the server has cut the buffer off before, per connection.
  if (line.length > MAX_REQUEST_BYTES || Buffer.byteLength(line) > MAX_REQUEST_BYTES) {
    return { id: -1, ...ipcError('request_too_large') };
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { id: -1, ...ipcError('invalid_json') };
  }
  const envelope = envelopeSchema.safeParse(value);
  const id = envelope.success ? envelope.data.id : -1;
  const actor = envelope.success ? envelope.data.actor : undefined;
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return { id, ...ipcError(failureCode(value)) };
  return actor === undefined ? { id, request: parsed.data } : { id, request: parsed.data, actor };
}

export const streamEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('snapshot'),
    seq: z.number().int(),
    runs: z.array(z.looseObject({ id: z.string() })),
    queues: z.array(z.looseObject({ repository: z.string() })).optional(),
    globalQueue: z.looseObject({ scope: z.literal('global') }).optional(),
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
    event: z.literal('globalQueue'),
    seq: z.number().int(),
    /** The global queue in the global mode; null once the mode is back to `project`. */
    globalQueue: z.looseObject({ scope: z.literal('global') }).nullable(),
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
  /** The log of an attempt has new lines or the attempt ended; never the text of the log. */
  z.strictObject({
    event: z.literal('log'),
    seq: z.number().int(),
    runId: z.string(),
    group: z.string(),
    attempt: z.number().int(),
  }),
  z.object({
    event: z.literal('processes'),
    seq: z.number().int(),
    processes: z.array(z.looseObject({ pid: z.number() })).optional(),
    error: z.string().optional(),
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;

export type BackgroundProcessesStreamEvent = Extract<StreamEvent, { event: 'processes' }>;
