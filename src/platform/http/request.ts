import { request as httpRequestNode, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequestNode } from 'node:https';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

import { appError, type AppError } from '../errors/index.ts';
import { openTunnel } from '../network/tunnel.ts';

/** Every failure of a request: a fixed code and a fixed text, never the address or a part of it. */
const FAILURES = {
  invalid_url: ['invalid', 'the address is not a valid URL'],
  unsupported_scheme: ['invalid', 'only http and https addresses are supported'],
  timeout: ['unavailable', 'the request timed out'],
  too_large: ['too_large', 'the response is too large'],
  proxy_refused: ['unavailable', 'the proxy refused the connection'],
  aborted: ['unavailable', 'the request was cancelled'],
  network: ['unavailable', 'the network request failed'],
} as const;

export type HttpFailure = keyof typeof FAILURES;

function failure(code: HttpFailure, errno?: string): AppError {
  const [kind, text] = FAILURES[code];
  return appError(kind, `http.${code}`, errno === undefined ? text : `${text} (${errno})`);
}

/** The code of a failure of `httpRequest`; null for any other error. */
export function httpFailureCode(error: unknown): HttpFailure | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('http.')) return null;
  const name = code.slice('http.'.length);
  return name in FAILURES ? (name as HttpFailure) : null;
}

export interface HttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** The whole request, from the connection to the end of the body of the answer. */
  timeoutMs: number;
  /** The longest answer body read; default 1 MiB. */
  maxResponseBytes?: number;
  /** An http(s) proxy that tunnels with CONNECT; loopback addresses never go through it. */
  proxy?: string | null;
  signal?: AbortSignal;
  /** Extra certificate authority of the server: for a private CA and for the tests. */
  ca?: string | Buffer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}

export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Loopback is reached directly even when a proxy is set: the proxy cannot see this machine. */
export function bypassProxy(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** The socket a request goes through: a tunnel of the proxy, with TLS on top for https. */
async function tunneled(
  proxy: string,
  url: URL,
  timeoutMs: number,
  ca?: string | Buffer,
): Promise<Duplex> {
  const secure = url.protocol === 'https:';
  const port = Number(url.port || (secure ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(proxy);
  } catch {
    throw failure('proxy_refused');
  }
  let socket: Duplex;
  try {
    socket = await openTunnel(proxyUrl, host, port, timeoutMs);
  } catch {
    throw failure('proxy_refused');
  }
  return secure
    ? tlsConnect({ socket, servername: host, ...(ca === undefined ? {} : { ca }) })
    : socket;
}

/**
 * One HTTP(S) request with a total time limit, a limit on the answer, no redirects (a 3xx is an
 * ordinary answer) and errors that never name the address: it may hold a token in its path.
 */
export function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    return Promise.reject(failure('invalid_url'));
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return Promise.reject(failure('unsupported_scheme'));
  }
  return perform(url, options);
}

function perform(url: URL, options: HttpRequestOptions): Promise<HttpResponse> {
  const limit = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const send = (
    url.protocol === 'https:' ? httpsRequestNode : httpRequestNode
  ) as typeof httpRequestNode;
  const proxied =
    options.proxy !== undefined && options.proxy !== null && !bypassProxy(url.hostname);
  const body = options.body === undefined ? null : Buffer.from(options.body);
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error: AppError | null, response?: HttpResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error !== null) request.destroy();
      if (error !== null) reject(error);
      else resolve(response!);
    };
    const timer = setTimeout(() => done(failure('timeout')), options.timeoutMs);
    const onAbort = (): void => done(failure('aborted'));
    const requestOptions: RequestOptions & { ca?: string | Buffer } = {
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      ...(url.port === '' ? {} : { port: url.port }),
      path: `${url.pathname}${url.search}`,
      method: options.method ?? 'GET',
      headers: {
        ...(body === null ? {} : { 'content-length': String(body.byteLength) }),
        ...options.headers,
      },
      // With a custom connection there is no agent: Node would make its own and ignore the function.
      ...(proxied ? {} : { agent: false }),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      ...(proxied
        ? {
            createConnection: (
              _options: unknown,
              oncreate: (error: Error | null, socket: Duplex) => void,
            ) => {
              tunneled(options.proxy!, url, options.timeoutMs, options.ca).then(
                (socket) => oncreate(null, socket),
                (error: unknown) => oncreate(error as Error, undefined as never),
              );
              return undefined;
            },
          }
        : {}),
    };
    const request = send(requestOptions, (response) => readBody(response, limit, done));
    request.on('error', (error: Error & { code?: string }) => {
      const known = httpFailureCode(error);
      done(known === null ? failure('network', error.code) : (error as unknown as AppError));
    });
    if (options.signal?.aborted === true) return onAbort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    request.end(body ?? undefined);
  });
}

function readBody(
  response: IncomingMessage,
  limit: number,
  done: (error: AppError | null, response?: HttpResponse) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.byteLength;
    if (size > limit) {
      response.destroy();
      done(failure('too_large'));
      return;
    }
    chunks.push(chunk);
  });
  response.on('error', (error: Error & { code?: string }) => done(failure('network', error.code)));
  response.on('end', () =>
    done(null, {
      status: response.statusCode ?? 0,
      headers: response.headers,
      body: new Uint8Array(Buffer.concat(chunks)),
    }),
  );
}
