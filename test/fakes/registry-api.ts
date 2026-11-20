import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';

export interface FakeRegistryRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  sessionId: string | undefined;
  body: Record<string, unknown> | null;
}

/** A skill the fake registry serves: `versions` maps a version to the bytes of its archive. */
export interface FakeSkill {
  id: string;
  name: string;
  versions: Record<string, Buffer>;
  title?: string;
  description?: string;
  tags?: string[];
}

/** A project of the catalog of a fake registry. */
export interface FakeProject {
  path: string;
  name: string;
  repo_url: string;
}

export interface FakeRegistry {
  /** The skills `list_skills` finds and the archives the REST endpoint serves. */
  skills: FakeSkill[];
  /** `<id>@<version>` of every archive downloaded. */
  downloads: string[];
  /** The page size of `list_skills` and `list_projects`; default 50. */
  pageSize: number;
  /** The root address, `http://127.0.0.1:<port>`. */
  base: string;
  port: number;
  token: string;
  requests: FakeRegistryRequest[];
  /** Ids of the sessions closed with DELETE. */
  closed: string[];
  /** How the registry answers a POST: a JSON body or an SSE stream (default JSON). */
  mode: 'json' | 'sse';
  /** The next answers by status instead of the normal one, one per POST. */
  failWith: number[];
  /** The tools `tools/list` returns. */
  tools: string[];
  /**
   * The catalog `list_projects` and `get_project` answer from, as JSON text; null: the tools only
   * echo the call.
   */
  projects: FakeProject[] | null;
  /** Replaces the answer of the next POST with this raw body (content type JSON). */
  rawBody: string | null;
  /** Holds every POST this long before answering. */
  delayMs: number;
  close(): Promise<void>;
}

/** An MCP registry on loopback: `initialize`, `tools/list`, `tools/call`, sessions, SSE. */
export async function startFakeRegistry(
  token = 'svcp_fake-registry-token-0123456789',
): Promise<FakeRegistry> {
  const state = {
    requests: [] as FakeRegistryRequest[],
    closed: [] as string[],
    mode: 'json' as 'json' | 'sse',
    failWith: [] as number[],
    tools: ['list_projects', 'get_doc', 'list_specs'],
    rawBody: null as string | null,
    delayMs: 0,
    skills: [] as FakeSkill[],
    downloads: [] as string[],
    pageSize: 50,
    projects: null as FakeProject[] | null,
  };
  let sessions = 0;

  const answer = (
    response: ServerResponse,
    message: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): void => {
    if (state.rawBody !== null) {
      response.writeHead(200, { 'content-type': 'application/json', ...headers });
      response.end(state.rawBody);
      state.rawBody = null;
      return;
    }
    if (state.mode === 'sse') {
      response.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
      response.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'x' })}\n\nevent: message\ndata: ${JSON.stringify(message)}\n\n`,
      );
    } else {
      response.writeHead(200, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(message));
    }
  };

  const handle = (request: IncomingMessage, response: ServerResponse, text: string): void => {
    let body: Record<string, unknown> | null = null;
    try {
      body = text === '' ? null : (JSON.parse(text) as Record<string, unknown>);
    } catch {
      body = null;
    }
    const sessionId = request.headers['mcp-session-id'];
    state.requests.push({
      method: request.method ?? '',
      path: request.url ?? '',
      authorization: request.headers.authorization,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      body,
    });
    const secret = `Bearer ${token}`;
    const failure = state.failWith.shift();
    if (request.headers.authorization !== secret || failure !== undefined) {
      response.writeHead(failure ?? 401, { 'content-type': 'text/plain' });
      response.end(`secret detail ${token}`);
      return;
    }
    const archive = /^\/api\/v1\/skills\/([^/]+)\/archive\?version=(.+)$/u.exec(request.url ?? '');
    if (request.method === 'GET' && archive !== null) {
      const id = decodeURIComponent(archive[1] ?? '');
      const version = decodeURIComponent(archive[2] ?? '');
      const bytes = state.skills.find((skill) => skill.id === id)?.versions[version];
      if (bytes === undefined) {
        response.writeHead(404).end();
        return;
      }
      state.downloads.push(`${id}@${version}`);
      response.writeHead(200, { 'content-type': 'application/zip' });
      response.end(bytes);
      return;
    }
    if (request.url !== '/api/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'DELETE') {
      if (typeof sessionId === 'string') state.closed.push(sessionId);
      response.writeHead(200).end();
      return;
    }
    if (body === null || body.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const id = body.id;
    switch (body.method) {
      case 'initialize': {
        sessions += 1;
        answer(
          response,
          {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake-registry', version: '1' },
            },
          },
          { 'mcp-session-id': `session-${sessions}` },
        );
        return;
      }
      case 'tools/list':
        answer(response, {
          jsonrpc: '2.0',
          id,
          result: {
            tools: state.tools.map((name) => ({
              name,
              description: name,
              inputSchema: { type: 'object' },
            })),
          },
        });
        return;
      case 'tools/call': {
        const params = (body.params ?? {}) as { name?: string; arguments?: unknown };
        if (params.name === 'list_skills') {
          const args = (params.arguments ?? {}) as { query?: string; page?: number };
          const found = state.skills.filter(
            (skill) => args.query === undefined || skill.name.includes(args.query),
          );
          const page = args.page ?? 1;
          const items = found
            .slice((page - 1) * state.pageSize, page * state.pageSize)
            .map((skill) => ({
              id: skill.id,
              name: skill.name,
              title: skill.title ?? skill.name,
              description: skill.description ?? '',
              tags: skill.tags ?? [],
              versions: Object.keys(skill.versions),
            }));
          answer(response, {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ items, has_more: page * state.pageSize < found.length }),
                },
              ],
            },
          });
          return;
        }
        const catalog = state.projects;
        if (catalog !== null && params.name === 'list_projects') {
          const args = (params.arguments ?? {}) as { limit?: number; offset?: number };
          const size = Math.min(args.limit ?? 200, state.pageSize);
          const offset = args.offset ?? 0;
          answer(response, {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ items: catalog.slice(offset, offset + size) }),
                },
              ],
            },
          });
          return;
        }
        if (catalog !== null && params.name === 'get_project') {
          const wanted = ((params.arguments ?? {}) as { project?: string }).project;
          const found = catalog.find((project) => project.path === wanted);
          answer(response, {
            jsonrpc: '2.0',
            id,
            result: found
              ? { content: [{ type: 'text', text: JSON.stringify(found) }] }
              : { isError: true, content: [{ type: 'text', text: 'project not found' }] },
          });
          return;
        }
        answer(response, {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `called ${params.name} ${JSON.stringify(params.arguments ?? {})}`,
              },
            ],
          },
        });
        return;
      }
      default:
        answer(response, {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'no such method' },
        });
    }
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (state.delayMs > 0) setTimeout(() => handle(request, response, text), state.delayMs);
      else handle(request, response, text);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return Object.assign(state, {
    base: `http://127.0.0.1:${port}`,
    port,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}

export interface FakeProxy {
  url: string;
  /** The `host:port` of every CONNECT and the Proxy-Authorization header it carried. */
  connects: { target: string; authorization: string | undefined }[];
  close(): Promise<void>;
}

/** A proxy that answers CONNECT and tunnels every target to `port` on loopback. */
export async function startFakeProxy(port: number, login?: string): Promise<FakeProxy> {
  const connects: FakeProxy['connects'] = [];
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on('connect', (request: IncomingMessage, client: Socket, head: Buffer) => {
    connects.push({
      target: request.url ?? '',
      authorization: request.headers['proxy-authorization'],
    });
    sockets.add(client);
    const upstream = connect({ host: '127.0.0.1', port }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyPort = (server.address() as { port: number }).port;
  return {
    url: `http://${login === undefined ? '' : `${login}@`}127.0.0.1:${proxyPort}`,
    connects,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
