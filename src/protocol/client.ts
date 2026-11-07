import { createConnection, type Socket } from 'node:net';

import { AppError, errorMessage } from '../platform/errors/index.ts';

import { responseSchema, type Method, type ParamsOf } from './messages.ts';

export class IpcError extends AppError {
  constructor(message: string) {
    super('rejected', message, { code: 'ipc.error' });
    this.name = 'IpcError';
  }
}

export class DaemonUnavailable extends AppError {
  constructor(path: string, cause: unknown) {
    super('unavailable', `aip daemon is not reachable at ${path}: ${errorMessage(cause)}`, {
      code: 'ipc.unavailable',
      cause,
    });
    this.name = 'DaemonUnavailable';
  }
}

export async function request<M extends Method>(
  socket: string,
  method: M,
  params: ParamsOf<M>,
  timeoutMs = 30_000,
): Promise<unknown> {
  const connection = await connect(socket);
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      connection.destroy();
      reject(new IpcError(`aip daemon did not answer ${method} within ${timeoutMs} ms`));
    }, timeoutMs);
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      clearTimeout(timer);
      connection.end();
      const parsed = responseSchema.safeParse(JSON.parse(buffer.slice(0, end)));
      if (!parsed.success) reject(new IpcError('malformed response from aip daemon'));
      else if (parsed.data.ok) resolve(parsed.data.result);
      else reject(new IpcError(parsed.data.error));
    });
    connection.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    connection.write(`${JSON.stringify({ id: 1, method, params })}\n`);
  });
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(path);
    connection.once('connect', () => resolve(connection));
    connection.once('error', (error) => reject(new DaemonUnavailable(path, error)));
  });
}

export function subscribe(
  socket: string,
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<'closed'> {
  return connect(socket).then(
    (connection) =>
      new Promise((resolve, reject) => {
        // Aborting closes the connection, so the subscription does not keep
        // the process alive.
        const close = () => connection.destroy();
        if (signal?.aborted) close();
        else signal?.addEventListener('abort', close, { once: true });
        connection.once('close', () => signal?.removeEventListener('abort', close));
        let buffer = '';
        connection.setEncoding('utf8');
        connection.on('data', (chunk: string) => {
          buffer += chunk;
          let end = buffer.indexOf('\n');
          while (end !== -1) {
            onLine(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            end = buffer.indexOf('\n');
          }
        });
        connection.on('close', () => resolve('closed'));
        connection.on('error', reject);
        connection.write(`${JSON.stringify({ id: 1, method: 'subscribe', params: {} })}\n`);
      }),
  );
}
