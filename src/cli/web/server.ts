import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { settingFieldOf, SLUG_PATTERN_TEXT, isValidSlug } from '../../config/index.ts';
import {
  IpcError,
  checkDaemon,
  currentBuild,
  pingDaemon,
  request,
  settingValueSchema,
  streamEventSchema,
  subscribe,
  type ConfigEditResult,
  type DaemonCheck,
  type Method,
  type ParamsOf,
} from '../../protocol/index.ts';

import { systemView } from './system.ts';

export interface WebOptions {
  socket: string;
  host?: string;
  port?: number;
  token?: string;
  /** `none` serves the panel without a token; the Host and Origin checks stay. */
  auth?: 'token' | 'none';
  /** Directory with the built panel; defaults to dist/web of the package. */
  assets?: string;
  /** Fixed repository of requests without `?repository=`; never the process directory. */
  repository?: string;
  /**
   * The repository of requests without `?repository=` when `repository` is not set; null when
   * there is none yet.
   */
  defaultRepository?: () => Promise<string | null>;
  /**
   * Checks the daemon before every connection to it and, while the daemon is older, every
   * {@link RECHECK_MS}; defaults to comparing the builds without starting or restarting it.
   */
  ensureDaemon?: () => Promise<DaemonCheck>;
  /**
   * Set by the daemon that serves this panel: restarts of the panel and of the daemon. Without it
   * (`aip web` on its own) both restarts answer 409 `web_standalone`.
   */
  system?: SystemHooks;
  /** Where failures after a response go (the daemon log); dropped by default. */
  log?: (line: string) => void;
}

export interface SystemHooks {
  restartWeb(): Promise<void>;
  restartDaemon(force: boolean): Promise<void>;
  /** The daemon log, shown in the system view. */
  logPath?: string;
}

/** How often a daemon older than the panel is checked again, so it is replaced once idle. */
export const RECHECK_MS = 30_000;

/** dist/web of the package, both from the sources (src/cli/web) and the build (dist/cli/web). */
export const DEFAULT_ASSETS = fileURLToPath(new URL('../../../dist/web/', import.meta.url));

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const PAGE_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MISSING_BUILD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>aip</title></head><body><h1>aip web</h1><p>The panel is not built. Run <code>npm run build</code> in the aip repository and reload this page.</p></body></html>`;

export interface WebServer {
  server: Server;
  /** null when the panel runs without a token. */
  token: string | null;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

const COOKIE = 'aip_token';
const BODY_LIMIT = 64 * 1024;
const skipBody = z.object({ step: z.string().trim().min(1), skip: z.boolean() });
const answerBody = z.object({ answer: z.string().trim().min(1) });
const retryBody = z.object({ refreshConfig: z.boolean().optional() });
const applyBody = z.object({
  groups: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

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

const levelParam = z.enum(['project', 'global']);
const previewBody = z.object({
  value: z.record(z.string(), z.unknown()),
  level: levelParam.optional(),
});
const writeBody = z.object({
  value: z.record(z.string(), z.unknown()),
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

const restartDaemonBody = z.object({ force: z.boolean().optional() });

const settingBody = z.object({
  value: settingValueSchema,
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

const settingsBody = z.object({
  values: z.record(z.string(), settingValueSchema),
  revision: z.string().min(1).nullable(),
  level: levelParam.optional(),
});

/** A handler result with its own status code. */
class Reply {
  readonly status: number;
  readonly value: unknown;
  constructor(status: number, value: unknown) {
    this.status = status;
    this.value = value;
  }
}

/** Maps the outcome of a configuration edit onto HTTP: 200, 422 for errors, 409 for a conflict. */
function editReply(result: ConfigEditResult): Reply {
  if (result.ok) return new Reply(200, result);
  if (result.reason === 'conflict') return new Reply(409, { error: result.message });
  return new Reply(422, { errors: result.errors, references: result.references ?? [] });
}

function entryId(value: string | undefined): string {
  const id = value ?? '';
  if (!isValidSlug(id)) throw new HttpError(400, `id must match ${SLUG_PATTERN_TEXT}`);
  return id;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sameToken(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return undefined;
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  type: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  response.end(body);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), 'application/json');
}

async function readJson(incoming: IncomingMessage): Promise<unknown> {
  if (!(incoming.headers['content-type'] ?? '').startsWith('application/json'))
    throw new HttpError(415, 'content-type must be application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

/** Fan-out of the daemon event stream; keeps the latest state of every run. */
class Hub {
  private readonly socket: string;
  private runs = new Map<string, unknown>();
  private queues = new Map<string, unknown>();
  private repositories: unknown[] = [];
  private tags: unknown[] = [];
  /** The last `processes` event of the daemon, without `seq`; null until it sends one. */
  private processes: { event: 'processes'; processes?: unknown[]; error?: string } | null = null;
  private seq = 0;
  private ready = false;
  private stopped = false;
  private readonly abort = new AbortController();
  private readonly clients = new Set<ServerResponse>();
  private readonly ensure: () => Promise<DaemonCheck>;
  /** Build mismatch with the daemon, as the panel shows it; null when the builds match. */
  private daemon: DaemonCheck['mismatch'] = null;
  private checking: Promise<void> | null = null;
  private readonly recheck: ReturnType<typeof setInterval>;

  constructor(socket: string, ensure: () => Promise<DaemonCheck>) {
    this.socket = socket;
    this.ensure = ensure;
    this.recheck = setInterval(() => {
      if (this.daemon?.outdated === 'daemon') void this.check();
    }, RECHECK_MS);
    this.recheck.unref();
    void this.connect();
  }

  private check(): Promise<void> {
    this.checking ??= this.ensure()
      .then(
        (result) => {
          if (JSON.stringify(result.mismatch) === JSON.stringify(this.daemon)) return;
          this.daemon = result.mismatch;
          this.broadcast({ event: 'daemon', daemon: this.daemon });
        },
        () => undefined, // the daemon is not reachable; the connection below retries
      )
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  private async connect(): Promise<void> {
    while (!this.stopped) {
      await this.check();
      if (this.stopped) break;
      try {
        await subscribe(this.socket, (line) => this.onLine(line), this.abort.signal);
      } catch {
        // the daemon is not reachable yet; retry below
      }
      this.ready = false;
      if (!this.stopped)
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          this.abort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve(undefined);
            },
            { once: true },
          );
        });
    }
  }

  private onLine(line: string): void {
    let event;
    try {
      event = streamEventSchema.parse(JSON.parse(line));
    } catch {
      return;
    }
    if (event.event === 'snapshot') {
      this.tags = event.tags ?? [];
      this.runs = new Map(event.runs.map((run) => [run.id, run]));
      this.queues = new Map((event.queues ?? []).map((queue) => [queue.repository, queue]));
      this.repositories = event.repositories ?? [];
      this.processes = null;
      this.ready = true;
      this.seq = event.seq;
      this.broadcast(this.snapshot());
    } else if (event.event === 'run') {
      this.runs.set(event.run.id, event.run);
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'repositories') {
      this.repositories = event.repositories;
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'queue') {
      this.queues.set(event.queue.repository, event.queue);
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'tags') {
      this.tags = event.tags;
      this.seq = event.seq;
      this.broadcast(event);
    } else if (event.event === 'processes') {
      const { seq, ...rest } = event;
      this.processes = rest;
      this.seq = seq;
      this.broadcast(event);
    }
  }

  private snapshot(): unknown {
    return {
      event: 'snapshot',
      seq: this.seq,
      runs: [...this.runs.values()],
      queues: [...this.queues.values()],
      repositories: this.repositories,
      tags: this.tags,
      daemon: this.daemon,
    };
  }

  private broadcast(event: unknown): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  attach(incoming: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write('retry: 2000\n\n');
    this.clients.add(response);
    if (this.ready) {
      response.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
      if (this.processes) {
        response.write(`data: ${JSON.stringify({ ...this.processes, seq: this.seq })}\n\n`);
      }
    }
    const beat = setInterval(() => response.write(': ping\n\n'), 15_000);
    incoming.on('close', () => {
      clearInterval(beat);
      this.clients.delete(response);
    });
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.recheck);
    this.abort.abort();
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}

type Handler = (match: string[], body: unknown, repository: string) => Promise<unknown>;

function transcriptQuery(search: URLSearchParams): { seq?: number; after?: number } {
  const query: { seq?: number; after?: number } = {};
  for (const [key, low] of [
    ['seq', 1],
    ['after', 0],
  ] as const) {
    const value = search.get(key);
    if (value === null) continue;
    const number = Number(value);
    if (!Number.isInteger(number) || number < low)
      throw new HttpError(400, `${key} must be an integer from ${low}`);
    query[key] = number;
  }
  return query;
}

export function assertLoopbackHost(host: string): void {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error('the web panel only listens on loopback: use 127.0.0.1, localhost or ::1');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** The fixed access token from `AIP_WEB_TOKEN`, or undefined when the variable is not set. */
export function webTokenFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.AIP_WEB_TOKEN;
  if (value === undefined || value === '') return undefined;
  if (!TOKEN_PATTERN.test(value))
    throw new Error('AIP_WEB_TOKEN must be 16-128 characters of A-Z, a-z, 0-9, - and _');
  return value;
}

export async function startWebServer(options: WebOptions): Promise<WebServer> {
  const open = options.auth === 'none';
  const token = open ? null : (options.token ?? randomBytes(24).toString('base64url'));
  const host = options.host ?? '127.0.0.1';
  assertLoopbackHost(host);
  const hub = new Hub(options.socket, options.ensureDaemon ?? (() => checkDaemon(options.socket)));
  const assets = normalize(options.assets ?? DEFAULT_ASSETS);
  const call = <M extends Method>(method: M, params: ParamsOf<M>) =>
    request(options.socket, method, params);
  let port = options.port ?? 0;

  const segment = '([^/]+)';
  /** The repository of a request: `?repository=` (absolute path) or the one of the panel. */
  const requestRepository = async (searchParams: URLSearchParams): Promise<string> => {
    const chosen = searchParams.get('repository');
    if (chosen === null || chosen === '') {
      if (options.repository !== undefined) return options.repository;
      const found = (await options.defaultRepository?.()) ?? null;
      if (found === null) throw new HttpError(409, 'no repository yet: add one in the panel');
      return found;
    }
    if (!isAbsolute(chosen)) throw new HttpError(400, 'repository must be an absolute path');
    return chosen;
  };
  /** Fields of a queue request body; the repository comes from the query string, never the body. */
  const queueBody = (body: unknown) => parseBody(z.record(z.string(), z.unknown()), body);
  const routes: { method: string; pattern: RegExp; handle: Handler }[] = [
    { method: 'GET', pattern: /^\/api\/runs$/, handle: () => call('status', {}) },
    {
      method: 'GET',
      pattern: new RegExp(`^/api/runs/${segment}$`),
      handle: ([runId]) => call('status', { runId: runId ?? '' }),
    },
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
      pattern: /^\/api\/workflows$/,
      handle: (_match, _body, repository) => call('workflows', { repository }),
    },
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
      method: 'PUT',
      pattern: /^\/api\/config\/settings$/,
      handle: async (_match, body, repository) => {
        const { values, revision, level } = parseBody(settingsBody, body);
        const unknown = Object.keys(values).filter((path) => settingFieldOf(path) === undefined);
        if (unknown.length > 0) {
          throw new HttpError(404, `setting \`${unknown.join('`, `')}\` cannot be written`);
        }
        if (Object.keys(values).length === 0) throw new HttpError(400, 'values must not be empty');
        return editReply(
          (await call('config_settings', {
            repository,
            values,
            revision,
            level: level ?? 'global',
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/settings/${segment}$`),
      handle: async ([path], body, repository) => {
        const known = path !== undefined && settingFieldOf(path) !== undefined ? path : undefined;
        if (known === undefined) {
          throw new HttpError(404, `setting \`${path ?? ''}\` cannot be written`);
        }
        const { value, revision, level } = parseBody(settingBody, body);
        return editReply(
          (await call('config_setting', {
            repository,
            path: known,
            value,
            revision,
            level: level ?? 'global',
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/api/config/(specialists|workflows)/${segment}$`),
      handle: async ([section, id], body, repository) => {
        const { revision, level } = body as { revision?: string; level?: 'project' | 'global' };
        if (!revision) throw new HttpError(400, 'revision is required');
        return editReply(
          (await call('config_delete', {
            repository,
            kind: section === 'workflows' ? 'workflow' : 'specialist',
            id: entryId(id),
            revision,
            level,
          })) as ConfigEditResult,
        );
      },
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/api/config/workflows/${segment}$`),
      handle: async ([id], body, repository) => {
        const { value, revision, level } = parseBody(writeBody, body);
        return editReply(
          (await call('config_write', {
            repository,
            kind: 'workflow',
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
      pattern: new RegExp(`^/api/config/workflows/${segment}/preview$`),
      handle: async ([id], body, repository) =>
        call('config_preview', {
          repository,
          kind: 'workflow',
          id: entryId(id),
          value: parseBody(previewBody, body).value,
          level: parseBody(previewBody, body).level,
        }),
    },
    { method: 'GET', pattern: /^\/api\/tags$/, handle: () => call('tags', {}) },
    {
      method: 'POST',
      pattern: /^\/api\/tags$/,
      handle: async (_, body) => call('tag_add', parseBody(tagAddBody, body)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tags\/edit$/,
      handle: async (_, body) => call('tag_edit', parseBody(tagEditBody, body)),
    },
    {
      method: 'POST',
      pattern: /^\/api\/tags\/remove$/,
      handle: async (_, body) => call('tag_remove', parseBody(tagRemoveBody, body)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/runs/${segment}/tags$`),
      handle: async ([runId], body) =>
        call('run_tags', { runId: runId ?? '', ...parseBody(runTagsBody, body) }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/processes$/,
      handle: () => call('processes', {}),
    },
    {
      method: 'POST',
      pattern: /^\/api\/processes\/([^/]+)\/kill$/,
      handle: ([pid]) => {
        if (!/^\d+$/.test(pid ?? '')) throw new HttpError(400, 'pid must be a positive integer');
        return call('process_kill', { pid: Number(pid) });
      },
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
  ];

  function hostAllowed(incoming: IncomingMessage): boolean {
    const given = incoming.headers.host?.toLowerCase();
    if (given === undefined) return false;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!allowed.has(given)) return false;
    const origin = incoming.headers.origin;
    if (origin === undefined) return true;
    try {
      return new URL(origin).host.toLowerCase() === given;
    } catch {
      return false;
    }
  }

  /** Runs `action` once the response is on its way: the restart closes this very server. */
  function afterResponse(response: ServerResponse, action: () => Promise<void>): void {
    response.once('finish', () => {
      setImmediate(() => {
        action().catch((error: unknown) => {
          options.log?.(`aip web: restart failed: ${(error as Error).message}`);
        });
      });
    });
  }

  async function handleSystem(
    incoming: IncomingMessage,
    response: ServerResponse,
    path: string,
    verb: string,
  ): Promise<void> {
    const hooks = options.system;
    if (path === '/api/system') {
      if (verb !== 'GET') throw new HttpError(405, 'method not allowed');
      const ping = await pingDaemon(options.socket).catch(() => null);
      const check =
        ping === null
          ? null
          : await (options.ensureDaemon ?? (() => checkDaemon(options.socket)))().catch(() => null);
      return json(
        response,
        200,
        systemView({
          ping,
          check,
          panelBuild: currentBuild(),
          servedBy: hooks === undefined ? 'standalone' : 'daemon',
          panel: { pid: process.pid, host, port, auth: open ? 'none' : 'token' },
          logPath: hooks?.logPath ?? null,
        }),
      );
    }
    const action =
      path === '/api/system/web/restart'
        ? 'web'
        : path === '/api/system/daemon/restart'
          ? 'daemon'
          : null;
    if (action === null) throw new HttpError(404, 'not found');
    if (verb !== 'POST') throw new HttpError(405, 'method not allowed');
    const body =
      action === 'daemon'
        ? parseBody(restartDaemonBody, await readJson(incoming))
        : parseBody(z.object({}), await readJson(incoming));
    if (hooks === undefined) {
      throw new HttpError(
        409,
        'this panel was started by `aip web`: restart it in the terminal',
        'web_standalone',
      );
    }
    if (action === 'web') {
      afterResponse(response, () => hooks.restartWeb());
    } else {
      const force = (body as { force?: boolean }).force === true;
      if (!force) {
        const ping = await pingDaemon(options.socket).catch(() => null);
        if (ping?.busy === true)
          throw new HttpError(
            409,
            'agents are running: restart anyway to stop them',
            'daemon_busy',
          );
      }
      afterResponse(response, () => hooks.restartDaemon(force));
    }
    json(response, 202, { state: 'restarting' });
  }

  async function handle(incoming: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!hostAllowed(incoming)) throw new HttpError(403, 'forbidden host or origin');
    const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host}`);
    const verb = incoming.method ?? 'GET';

    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (verb !== 'GET') throw new HttpError(405, 'method not allowed');
      const fromQuery = url.searchParams.get('token') ?? undefined;
      if (
        token !== null &&
        !sameToken(fromQuery, token) &&
        !sameToken(cookieToken(incoming.headers.cookie), token)
      )
        throw new HttpError(401, 'open the URL printed by `aip web`: it contains the access token');
      const index = join(assets, 'index.html');
      const page = existsSync(index) ? readFileSync(index, 'utf8') : MISSING_BUILD;
      send(response, 200, page, 'text/html', {
        ...(token === null
          ? {}
          : { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict` }),
        'content-security-policy': PAGE_POLICY,
        'cache-control': 'no-cache',
      });
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      if (verb !== 'GET') throw new HttpError(405, 'method not allowed');
      const file = normalize(join(assets, decodeURIComponent(url.pathname)));
      if (!file.startsWith(assets.endsWith(sep) ? assets : `${assets}${sep}`) || !existsSync(file))
        throw new HttpError(404, 'not found');
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      response.writeHead(200, {
        'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type,
        // Vite names assets by their content hash, so they never change.
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      response.end(readFileSync(file));
      return;
    }

    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
    if (token !== null) {
      const given =
        (incoming.headers['x-aip-token'] as string | undefined) ??
        cookieToken(incoming.headers.cookie);
      if (!sameToken(given, token)) throw new HttpError(401, 'missing or invalid token');
    }

    if (url.pathname === '/api/events') {
      if (verb !== 'GET') throw new HttpError(405, 'method not allowed');
      hub.attach(incoming, response);
      return;
    }

    if (url.pathname === '/api/repositories') {
      if (verb === 'GET') return json(response, 200, await call('repositories', {}));
      if (verb === 'POST') {
        const { path } = parseBody(z.object({ path: z.string().min(1) }), await readJson(incoming));
        if (!isAbsolute(path)) throw new HttpError(400, 'path must be an absolute path');
        return json(response, 200, await call('repository_add', { path }));
      }
      if (verb === 'DELETE') {
        const path = url.searchParams.get('repository');
        if (path === null || !isAbsolute(path)) {
          throw new HttpError(400, 'repository must be an absolute path');
        }
        return json(response, 200, await call('repository_remove', { path }));
      }
      throw new HttpError(405, 'method not allowed');
    }

    if (url.pathname.startsWith('/api/system')) {
      await handleSystem(incoming, response, url.pathname, verb);
      return;
    }

    let wrongMethod = false;
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      if (route.method !== verb) {
        wrongMethod = true;
        continue;
      }
      let parts: string[];
      try {
        parts = match.slice(1).map((part) => decodeURIComponent(part));
      } catch {
        throw new HttpError(400, 'malformed percent-encoding in path');
      }
      let body: unknown = {};
      if (verb === 'POST' || verb === 'PUT') body = await readJson(incoming);
      else if (verb === 'DELETE') {
        const revision = url.searchParams.get('revision');
        const level = url.searchParams.get('level');
        if (level !== null && level !== 'project' && level !== 'global') {
          throw new HttpError(400, 'level must be project or global');
        }
        body = { ...(revision ? { revision } : {}), ...(level ? { level } : {}) };
      } else if (/\/groups\/[^/]+$/.test(url.pathname)) {
        const tail = Number(url.searchParams.get('tail') ?? 40);
        if (!Number.isInteger(tail) || tail < 1 || tail > 500)
          throw new HttpError(400, 'tail must be an integer from 1 to 500');
        body = { tail };
      } else if (url.pathname.endsWith('/transcript')) {
        body = transcriptQuery(url.searchParams);
      }
      // Runs belong to the daemon, not to a repository: they work without one.
      // A returned run belongs to its own repository unless the request names one.
      const ownRepository =
        (url.pathname === '/api/queue/return' || url.pathname === '/api/queue/dismiss') &&
        !url.searchParams.get('repository');
      const repository =
        url.pathname.startsWith('/api/runs') ||
        url.pathname.startsWith('/api/processes') ||
        ownRepository
          ? ''
          : await requestRepository(url.searchParams);
      const result = await route.handle(parts, body, repository);
      if (result instanceof Reply) json(response, result.status, result.value);
      else json(response, 200, result);
      return;
    }
    if (wrongMethod) throw new HttpError(405, 'method not allowed');
    throw new HttpError(404, 'not found');
  }

  const server = createServer((incoming, response) => {
    handle(incoming, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError)
        json(response, error.status, {
          error: error.message,
          ...(error.code === undefined ? {} : { code: error.code }),
        });
      else if (error instanceof IpcError) {
        const status = /^(unknown (run|group|attempt|queue item)\b|not a background process)/.test(
          error.message,
        )
          ? 404
          : /^aip daemon did not answer/.test(error.message)
            ? 504
            : error.message.startsWith('malformed response')
              ? 502
              : 400;
        json(response, status, { error: error.message });
      } else json(response, 502, { error: (error as Error).message });
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
  } catch (error) {
    hub.stop();
    throw error;
  }
  port = (server.address() as AddressInfo).port;
  const shown = host.includes(':') ? `[${host}]` : host;
  return {
    server,
    token,
    host,
    port,
    url: `http://${shown}:${port}/${token === null ? '' : `?token=${token}`}`,
    close: () =>
      new Promise((resolve) => {
        hub.stop();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
