import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

export type ProbeResult = { ok: true } | { ok: false; problem: string };

export const reachable: ProbeResult = { ok: true };

export function unreachable(problem: string): ProbeResult {
  return { ok: false, problem };
}

/** The proxy URL without login and password, for messages. */
export function proxyName(proxy: URL): string {
  return `${proxy.protocol}//${proxy.host}`;
}

export function proxyUrl(proxy: string): URL {
  return new URL(proxy);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== undefined && !error.message.includes(code)
      ? `${code}: ${error.message}`
      : error.message;
  }
  return String(error);
}

/** Opens a socket to `host:port` and fails after `timeoutMs`. */
export function openSocket(
  host: string,
  port: number,
  timeoutMs: number,
  secure = false,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? connectTls({ host, port, servername: host })
      : connectTcp({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

/** Asks the proxy to open a tunnel to `host:port` with `CONNECT`; resolves with the tunnel. */
export async function openTunnel(
  proxy: URL,
  host: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
  const deadline = Date.now() + timeoutMs;
  const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
  const socket = await openSocket(
    proxy.hostname,
    proxyPort,
    timeoutMs,
    proxy.protocol === 'https:',
  );
  const target = `${host}:${port}`;
  const credentials =
    proxy.username === '' && proxy.password === ''
      ? ''
      : `Proxy-Authorization: Basic ${Buffer.from(
          `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
        ).toString('base64')}\r\n`;
  return new Promise((resolve, reject) => {
    let received = '';
    const timer = setTimeout(
      () => fail(new Error(`no answer in ${timeoutMs} ms`)),
      Math.max(deadline - Date.now(), 1),
    );
    const finish = (): void => {
      clearTimeout(timer);
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
    };
    const fail = (error: Error): void => {
      finish();
      socket.destroy();
      reject(error);
    };
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('latin1');
      const end = received.indexOf('\r\n\r\n');
      if (end === -1) return;
      const status = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(received)?.[1];
      if (status !== undefined && status.startsWith('2')) {
        finish();
        resolve(socket);
      } else {
        fail(new Error(`CONNECT ${target}: HTTP ${status ?? 'unknown answer'}`));
      }
    });
    socket.once('error', fail);
    socket.once('close', () => fail(new Error('the proxy closed the connection')));
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${credentials}\r\n`);
  });
}
