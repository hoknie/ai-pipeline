import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

import {
  describeError,
  openSocket,
  openTunnel,
  proxyName,
  proxyUrl,
  reachable,
  unreachable,
  type ProbeResult,
} from './tunnel.ts';

/** Whether an HTTP code means the target is blocked or broken rather than reachable. */
export function blockedStatus(status: number): boolean {
  return status === 403 || status === 407 || status >= 500;
}

/** The time left until `deadline`, at least 1 ms. */
function left(deadline: number): number {
  return Math.max(deadline - Date.now(), 1);
}

function viaProxy<T>(
  proxy: string,
  run: (url: URL) => Promise<T>,
  fail: (p: string) => T,
): Promise<T> {
  let url: URL;
  try {
    url = proxyUrl(proxy);
  } catch {
    return Promise.resolve(fail('invalid proxy URL'));
  }
  return run(url);
}

/** A TCP connection to `host:port`, directly or through the proxy with `CONNECT`. */
export async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
  proxy?: string | null,
): Promise<ProbeResult> {
  const target = `${host}:${port}`;
  const deadline = Date.now() + timeoutMs;
  try {
    if (proxy) {
      return await viaProxy(
        proxy,
        async (url) => {
          try {
            (await openTunnel(url, host, port, left(deadline))).destroy();
            return reachable;
          } catch (error) {
            return unreachable(`${target} via ${proxyName(url)}: ${describeError(error)}`);
          }
        },
        (problem) => unreachable(`${target}: ${problem}`),
      );
    }
    (await openSocket(host, port, left(deadline))).destroy();
    return reachable;
  } catch (error) {
    return unreachable(`${target}: ${describeError(error)}`);
  }
}

function getStatus(
  url: URL,
  timeoutMs: number,
  options: Parameters<typeof httpRequest>[1],
  send: typeof httpRequest,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = send(url, {
      method: 'GET',
      ...(options?.createConnection === undefined ? { agent: false } : {}),
      timeout: timeoutMs,
      ...options,
    });
    const timer = setTimeout(
      () => request.destroy(new Error(`timeout after ${timeoutMs} ms`)),
      timeoutMs,
    );
    request.once('response', (response) => {
      clearTimeout(timer);
      response.destroy();
      resolve(response.statusCode ?? 0);
    });
    request.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

async function tunnelledStatus(url: URL, proxy: URL, deadline: number): Promise<number> {
  const secure = url.protocol === 'https:';
  const port = Number(url.port || (secure ? 443 : 80));
  const tunnel: Socket = await openTunnel(proxy, url.hostname, port, left(deadline));
  const connection = secure ? connectTls({ socket: tunnel, servername: url.hostname }) : tunnel;
  try {
    return await getStatus(
      url,
      left(deadline),
      { createConnection: () => connection },
      secure ? (httpsRequest as typeof httpRequest) : httpRequest,
    );
  } finally {
    connection.destroy();
    tunnel.destroy();
  }
}

/** A GET request without credentials: reachable unless the answer is 403, 407 or 5xx. */
export async function probeHttp(
  target: string,
  timeoutMs: number,
  proxy?: string | null,
): Promise<ProbeResult> {
  const deadline = Date.now() + timeoutMs;
  let proxied: URL | null = null;
  let via = '';
  try {
    if (proxy) {
      proxied = proxyUrl(proxy);
      via = ` via ${proxyName(proxied)}`;
    }
  } catch (error) {
    return unreachable(`${target}: invalid proxy: ${describeError(error)}`);
  }
  try {
    const url = new URL(target);
    let status: number;
    if (proxied) {
      if (url.protocol === 'https:') {
        status = await tunnelledStatus(url, proxied, deadline);
      } else {
        // A plain HTTP target goes to the proxy in the absolute form.
        status = await getStatus(
          new URL(target),
          left(deadline),
          {
            hostname: proxied.hostname,
            port: Number(proxied.port || 80),
            path: target,
            headers: {
              host: url.host,
              ...(proxied.username === '' && proxied.password === ''
                ? {}
                : {
                    'proxy-authorization': `Basic ${Buffer.from(
                      `${decodeURIComponent(proxied.username)}:${decodeURIComponent(proxied.password)}`,
                    ).toString('base64')}`,
                  }),
            },
          },
          httpRequest,
        );
      }
    } else {
      status = await getStatus(
        url,
        left(deadline),
        {},
        url.protocol === 'https:' ? (httpsRequest as typeof httpRequest) : httpRequest,
      );
    }
    return blockedStatus(status) ? unreachable(`${target}${via}: HTTP ${status}`) : reachable;
  } catch (error) {
    return unreachable(`${target}${via}: ${describeError(error)}`);
  }
}
