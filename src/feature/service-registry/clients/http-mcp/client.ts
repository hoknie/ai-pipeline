import { httpFailureCode, httpRequest } from '../../../../platform/http/index.ts';
import type { RegistryTransportPort } from '../../ports/index.ts';
import {
  RegistryFailure,
  type McpEndpoint,
  type McpReply,
  type RegistryCode,
} from '../../types/index.ts';

/** The longest answer of a registry the daemon reads. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** The longest one request lasts. */
export const REQUEST_TIMEOUT_MS = 120_000;

const pathOf = (base: string): string => `${base}/api/mcp`;

export function codeOfStatus(status: number): RegistryCode | null {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429 || status >= 500) return 'unreachable';
  if (status < 200 || status >= 300) return 'protocol';
  return null;
}

/** Only a proxy that tunnels with an HTTP `CONNECT` can carry the request. */
export function usableProxy(proxy: string | null): string | null {
  if (proxy === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new RegistryFailure('unreachable');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // only the scheme is logged: a proxy URL may carry credentials
    process.stderr.write(
      `service-registry: proxy scheme ${parsed.protocol}// cannot carry MCP requests; the registry is unreachable\n`,
    );
    throw new RegistryFailure('unreachable');
  }
  return proxy;
}

async function send(
  endpoint: McpEndpoint,
  method: 'POST' | 'DELETE',
  body: string | undefined,
): Promise<{ status: number; type: string; text: string; sessionId: string | null }> {
  const url = pathOf(endpoint.base);
  const proxy = usableProxy(endpoint.proxyFor(url));
  let response;
  try {
    response = await httpRequest({
      url,
      method,
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        accept: 'application/json, text/event-stream',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(endpoint.sessionId ? { 'mcp-session-id': endpoint.sessionId } : {}),
      },
      ...(body === undefined ? {} : { body }),
      timeoutMs: endpoint.timeoutMs ?? REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      proxy,
      ...(endpoint.signal === undefined ? {} : { signal: endpoint.signal }),
    });
  } catch (error) {
    const failure = httpFailureCode(error);
    throw new RegistryFailure(
      failure === 'timeout' ? 'timeout' : failure === 'too_large' ? 'too_large' : 'unreachable',
    );
  }
  const header = (name: string): string | null => {
    const value = response.headers[name];
    return typeof value === 'string' ? value : null;
  };
  const failure = codeOfStatus(response.status);
  if (failure !== null) throw new RegistryFailure(failure);
  return {
    status: response.status,
    type: (header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '',
    text: Buffer.from(response.body).toString('utf8'),
    sessionId: header('mcp-session-id'),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matches(value: unknown, id: unknown): value is Record<string, unknown> {
  return isObject(value) && value.id === id && ('result' in value || 'error' in value);
}

/** The data of every event of a `text/event-stream` body, in order. */
function eventData(text: string): string[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n'),
    )
    .filter((data) => data !== '');
}

function answerOf(type: string, text: string, id: unknown): Record<string, unknown> {
  const candidates: unknown[] = [];
  try {
    if (type === 'application/json') {
      const parsed: unknown = JSON.parse(text);
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } else if (type === 'text/event-stream') {
      for (const data of eventData(text)) candidates.push(JSON.parse(data));
    }
  } catch {
    throw new RegistryFailure('protocol');
  }
  const answer = candidates.find((one) => matches(one, id));
  if (answer === undefined || !isObject(answer)) throw new RegistryFailure('protocol');
  return answer;
}

/**
 * Posts one JSON-RPC message to the registry and returns its answer: a JSON body or the first
 * event of an SSE stream with the id of the request. A notification has no answer.
 */
export async function mcpPost(
  endpoint: McpEndpoint,
  message: Record<string, unknown>,
): Promise<McpReply> {
  const reply = await send(endpoint, 'POST', JSON.stringify(message));
  const id = message.id;
  if (id === undefined || id === null) return { message: null, sessionId: reply.sessionId };
  return { message: answerOf(reply.type, reply.text, id), sessionId: reply.sessionId };
}

/** Closes the session of the registry; a registry that has no such call is not an error. */
export async function mcpClose(endpoint: McpEndpoint): Promise<void> {
  if (!endpoint.sessionId) return;
  try {
    await send(endpoint, 'DELETE', undefined);
  } catch {
    // the session ends on its own; the caller has nothing to do about it
  }
}

/** One GET of a file of the registry (the archive of a skill) with the bearer token. */
export async function registryDownload(
  endpoint: McpEndpoint,
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  const url = `${endpoint.base}${path}`;
  const proxy = usableProxy(endpoint.proxyFor(url));
  let response;
  try {
    response = await httpRequest({
      url,
      method: 'GET',
      headers: { authorization: `Bearer ${endpoint.token}`, accept: 'application/zip' },
      timeoutMs: endpoint.timeoutMs ?? 60_000,
      maxResponseBytes: maxBytes,
      proxy,
      ...(endpoint.signal === undefined ? {} : { signal: endpoint.signal }),
    });
  } catch (error) {
    const failure = httpFailureCode(error);
    throw new RegistryFailure(
      failure === 'timeout' ? 'timeout' : failure === 'too_large' ? 'too_large' : 'unreachable',
    );
  }
  const failure = codeOfStatus(response.status);
  if (failure !== null) throw new RegistryFailure(failure);
  return Buffer.from(response.body);
}

/** The HTTP client of a registry as the port of the feature. */
export const httpMcpTransport: RegistryTransportPort = {
  post: mcpPost,
  close: mcpClose,
  download: registryDownload,
};
