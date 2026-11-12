import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalize } from 'node:path';

import { checkDaemon, request } from '../ipc/client/index.ts';
import type { Method, ParamsOf } from '../ipc/contract/index.ts';

import { TOKEN_HINT, configError, panel, renderPanelError } from './errors.ts';
import { Hub } from './hub.ts';
import {
  cookieToken,
  decodeParts,
  hostAllowed,
  json,
  parseBody,
  Reply,
  sameToken,
} from './http.ts';
import { DEFAULT_ASSETS, type WebOptions, type WebServer } from './options.ts';
import { serveAsset, servePage } from './pages.ts';
import { requestBody, requestRepository } from './request.ts';
import { configRoutes } from './routes/config.ts';
import { artifactRoute, patchRoute } from './routes/downloads.ts';
import { groupsRoutes } from './routes/groups.ts';
import { processesRoutes } from './routes/processes.ts';
import { queueRoutes } from './routes/queue.ts';
import { directoriesRoute, repositoriesRoute } from './routes/repositories.ts';
import { runsRoutes } from './routes/runs.ts';
import { settingsRoutes } from './routes/settings.ts';
import { observerHistoryRoutes } from './routes/observers/history.ts';
import { specialistsRoutes } from './routes/specialists.ts';
import { statsRoutes } from './routes/stats/stats.ts';
import { systemRoute } from './routes/system.ts';
import { tagsRoutes } from './routes/tags.ts';
import type { RawRoute, Route, RouteKit } from './routes/types.ts';

export type { WebOptions, WebServer, SystemHooks } from './options.ts';
export { DEFAULT_ASSETS, RECHECK_MS } from './options.ts';

export function assertLoopbackHost(host: string): void {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw configError('the web panel only listens on loopback: use 127.0.0.1, localhost or ::1');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** The fixed access token from `AIP_WEB_TOKEN`, or undefined when the variable is not set. */
export function webTokenFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.AIP_WEB_TOKEN;
  if (value === undefined || value === '') return undefined;
  if (!TOKEN_PATTERN.test(value))
    throw configError('AIP_WEB_TOKEN must be 16-128 characters of A-Z, a-z, 0-9, - and _');
  return value;
}

/** The routes of the panel in the order they are tried: the raw ones, then the JSON table. */
function routeTable(kit: RouteKit): { raw: RawRoute[]; table: Route[] } {
  return {
    raw: [
      repositoriesRoute(kit),
      directoriesRoute(),
      systemRoute(kit),
      patchRoute(kit),
      artifactRoute(kit),
    ],
    table: [
      runsRoutes,
      groupsRoutes,
      queueRoutes,
      configRoutes,
      settingsRoutes,
      observerHistoryRoutes,
      specialistsRoutes,
      tagsRoutes,
      processesRoutes,
      statsRoutes,
    ].flatMap((routes) => routes(kit)),
  };
}

interface Dispatch {
  token: string | null;
  assets: string;
  hub: Hub;
  kit: RouteKit;
  raw: RawRoute[];
  table: Route[];
}

/** The JSON route that matches the request; a path that matches with another verb is a 405. */
async function runTable(
  d: Dispatch,
  incoming: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const verb = incoming.method ?? 'GET';
  let wrongMethod = false;
  for (const route of d.table) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    if (route.method !== verb) {
      wrongMethod = true;
      continue;
    }
    const parts = decodeParts(match.slice(1));
    const body = await requestBody(incoming, url);
    const repository = await requestRepository(url, d.kit.options);
    const result = await route.handle(parts, body, repository, url.searchParams);
    if (result instanceof Reply) json(response, result.status, result.value);
    else json(response, 200, result);
    return;
  }
  if (wrongMethod) throw panel('method_not_allowed', 'method not allowed');
  throw panel('not_found', 'not found');
}

async function handleApi(
  d: Dispatch,
  incoming: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const verb = incoming.method ?? 'GET';
  if (d.token !== null) {
    const given =
      (incoming.headers['x-aip-token'] as string | undefined) ??
      cookieToken(incoming.headers.cookie);
    if (!sameToken(given, d.token)) throw panel('unauthorized', 'missing or invalid token');
  }
  if (url.pathname === '/api/events') {
    if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
    d.hub.attach(incoming, response);
    return;
  }
  for (const route of d.raw) {
    const match = route.pattern.exec(url.pathname);
    if (match) return route.handle({ incoming, response, url, match, verb });
  }
  return runTable(d, incoming, response, url);
}

async function handle(
  d: Dispatch,
  port: number,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!hostAllowed(incoming, port)) throw panel('forbidden', 'forbidden host or origin');
  const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host}`);
  const verb = incoming.method ?? 'GET';
  const isPage = url.pathname === '/' || url.pathname === '/index.html';
  const isAsset = url.pathname.startsWith('/assets/');
  if (isPage || isAsset) {
    if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
    if (isAsset) return serveAsset(response, d.assets, url.pathname);
    const fromQuery = url.searchParams.get('token') ?? undefined;
    return servePage(response, d.assets, d.token, fromQuery, incoming.headers.cookie);
  }
  if (!url.pathname.startsWith('/api/')) throw panel('not_found', 'not found');
  return handleApi(d, incoming, response, url);
}

export async function startWebServer(options: WebOptions): Promise<WebServer> {
  const open = options.auth === 'none';
  const token = open ? null : (options.token ?? randomBytes(24).toString('base64url'));
  const host = options.host ?? '127.0.0.1';
  assertLoopbackHost(host);
  const ensureDaemon = options.ensureDaemon ?? (() => checkDaemon(options.socket));
  const hub = new Hub(options.socket, ensureDaemon);
  let port = options.port ?? 0;
  const kit: RouteKit = {
    call: <M extends Method>(method: M, params: ParamsOf<M>) =>
      request(options.socket, method, params),
    options,
    host,
    port: () => port,
    open,
    ensureDaemon,
  };
  const dispatch: Dispatch = {
    token,
    assets: normalize(options.assets ?? DEFAULT_ASSETS),
    hub,
    kit,
    ...routeTable(kit),
  };
  const server = createServer((incoming, response) => {
    handle(dispatch, port, incoming, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const rendered = renderPanelError(error);
      json(response, rendered.status, rendered.body);
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
