import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

import { checkDaemon, request } from '../ipc/client/index.ts';
import type { DaemonCheck, Method, ParamsOf } from '../ipc/contract/index.ts';

import { assertLocalHost, assertServerHost, assertToken, connectionIdentity } from './access.ts';
import { requestContext } from './auth/context.ts';
import { authRoute, createGate, ipcRoute, type ServerGate } from './auth/routes.ts';
import { TOKEN_HINT, configError, panel, renderPanelError } from './errors.ts';
import { Hub } from './hub.ts';
import { topicReader } from './live/read.ts';
import { serveLive } from './live/socket.ts';
import { Topics } from './live/topics.ts';
import { decodeParts, json, parseBody, Reply } from './http.ts';
import { DEFAULT_ASSETS, type WebOptions, type WebServer } from './options.ts';
import { serveAsset, servePage } from './pages.ts';
import { requestBody, requestRepository } from './request.ts';
import { configRoutes } from './routes/config.ts';
import { providerRoutes } from './routes/providers/providers.ts';
import { artifactRoute, attachmentRoute, patchRoute } from './routes/downloads.ts';
import { groupsRoutes } from './routes/groups.ts';
import { processesRoutes } from './routes/processes.ts';
import { queueRoutes } from './routes/queue.ts';
import { directoriesRoute, repositoriesRoute } from './routes/repositories.ts';
import { runsRoutes } from './routes/runs.ts';
import { mcpServerRoutes } from './routes/catalog/mcp-servers.ts';
import { settingsRoutes } from './routes/settings.ts';
import { observerHistoryRoutes } from './routes/observers/history.ts';
import { specialistsRoutes } from './routes/specialists.ts';
import { accessRoutes } from './routes/access/access.ts';
import { auditRoutes } from './routes/audit/audit.ts';
import { statsRoutes } from './routes/stats/stats.ts';
import { sweepUploads, UPLOAD_SWEEP_MS, uploadRoute } from './uploads.ts';
import { systemRoute } from './routes/system.ts';
import { integrationsRoutes } from './routes/integrations/integrations.ts';
import { webhooksRoutes } from './routes/integrations/webhooks.ts';
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
      attachmentRoute(kit),
      uploadRoute(kit),
    ],
    table: [
      runsRoutes,
      groupsRoutes,
      queueRoutes,
      configRoutes,
      providerRoutes,
      settingsRoutes,
      mcpServerRoutes,
      observerHistoryRoutes,
      specialistsRoutes,
      tagsRoutes,
      processesRoutes,
      statsRoutes,
      auditRoutes,
      accessRoutes,
      integrationsRoutes,
      webhooksRoutes,
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
  gate: ServerGate | null;
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
  assertToken(incoming, d.token);
  if (d.gate !== null && url.pathname === '/api/ipc/events') {
    if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
    d.hub.attach(incoming, response, requestContext.getStore()?.actor);
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
  if (d.gate !== null) return handleServerMode(d, d.gate, incoming, response);
  assertLocalHost(incoming, port);
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

/** Server mode: the host and origin of `public_url`, the login routes, then a session or a token. */
async function handleServerMode(
  d: Dispatch,
  gate: ServerGate,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(incoming.url ?? '/', 'http://panel');
  // the ACS is posted by the browser from the site of the provider, so its `Origin` is the provider's;
  // the signature, the stored request and the replay check protect it instead
  const acs = url.pathname === '/auth/saml/acs' && incoming.method === 'POST';
  assertServerHost(incoming, gate, url.pathname === '/auth/cli/token', acs);
  if (await authRoute(gate, incoming, response, url)) return;
  const verb = incoming.method ?? 'GET';
  if (url.pathname.startsWith('/assets/')) {
    if (verb !== 'GET') throw panel('method_not_allowed', 'method not allowed');
    return serveAsset(response, d.assets, url.pathname);
  }
  const user = await gate.auth.identify(incoming);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    if (user === null) {
      response.writeHead(302, { location: '/auth/login', 'cache-control': 'no-store' });
      response.end();
      return;
    }
    return servePage(response, d.assets, null, undefined, undefined);
  }
  if (!url.pathname.startsWith('/api/')) throw panel('not_found', 'not found');
  if (user === null) throw panel('unauthorized', 'sign in or send a personal token');
  if (url.pathname === '/api/directories' && !(await mayAddProjects(d, user))) {
    throw panel(
      'forbidden',
      'directories are listed for those who may add projects',
      'access.denied',
    );
  }
  await requestContext.run({ actor: user.id }, async () => {
    if (url.pathname === '/api/ipc') {
      if (verb !== 'POST') throw panel('method_not_allowed', 'method not allowed');
      return ipcRoute(gate, incoming, response);
    }
    return handleApi(d, incoming, response, url);
  });
}

/** The path picker serves whoever may add a project: in server mode the policies say, else the role. */
async function mayAddProjects(d: Dispatch, user: { id: string; admin: boolean }): Promise<boolean> {
  if (d.kit.options.server === undefined) return user.admin;
  const me = (await request(d.kit.options.socket, 'access_me', {}, undefined, user.id)) as {
    actions: string[];
  };
  return me.actions.includes('project.add');
}

/** The hub of the events; in server mode every subscriber gets only the projects it reads. */
function createHub(options: WebOptions, ensureDaemon: () => Promise<DaemonCheck>, topics: Topics) {
  const readable =
    options.server === undefined
      ? undefined
      : async (actor: string) =>
          (
            (await request(options.socket, 'access_me', {}, undefined, actor)) as {
              repositories: string[] | null;
            }
          ).repositories;
  return new Hub(options.socket, ensureDaemon, (signal) => topics.signal(signal), readable);
}

export async function startWebServer(options: WebOptions): Promise<WebServer> {
  const serverMode = options.server !== undefined;
  const open = !serverMode && options.auth === 'none';
  const token =
    open || serverMode ? null : (options.token ?? randomBytes(24).toString('base64url'));
  const host = options.host ?? '127.0.0.1';
  if (!serverMode) assertLoopbackHost(host);
  const ensureDaemon = options.ensureDaemon ?? (() => checkDaemon(options.socket));
  const topics = new Topics(topicReader(options.socket, options));
  const hub = createHub(options, ensureDaemon, topics);
  let port = options.port ?? 0;
  const kit: RouteKit = {
    call: <M extends Method>(method: M, params: ParamsOf<M>) =>
      request(options.socket, method, params, undefined, requestContext.getStore()?.actor),
    options,
    host,
    uploads: join(options.stateDirectory ?? join(tmpdir(), 'aip-web'), 'uploads'),
    port: () => port,
    open,
    ensureDaemon,
  };
  const dispatch: Dispatch = {
    token,
    assets: normalize(options.assets ?? DEFAULT_ASSETS),
    hub,
    kit,
    gate: options.server === undefined ? null : createGate(options.socket, options.server),
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
  const stopLive = serveLive(server, {
    identify: (incoming) => connectionIdentity({ token, gate: dispatch.gate, port }, incoming),
    join: (send, actor) => hub.join(send, actor),
    topics,
    ...options.live,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
  } catch (error) {
    stopLive();
    hub.stop();
    throw error;
  }
  port = (server.address() as AddressInfo).port;
  sweepUploads(kit.uploads, Date.now());
  const sweeper = setInterval(() => sweepUploads(kit.uploads, Date.now()), UPLOAD_SWEEP_MS);
  sweeper.unref();
  const shown = host.includes(':') ? `[${host}]` : host;
  return {
    server,
    token,
    host,
    port,
    url: options.server
      ? options.server.publicUrl
      : `http://${shown}:${port}/${token === null ? '' : `?token=${token}`}`,
    close: () =>
      new Promise((resolve) => {
        clearInterval(sweeper);
        stopLive();
        hub.stop();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
