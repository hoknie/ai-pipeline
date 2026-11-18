import { AppError } from '../../../platform/errors/index.ts';
import type { RemoteDaemon } from './address.ts';
import { DaemonUnavailable, IpcError } from './client.ts';

function base(remote: RemoteDaemon): string {
  return remote.url.replace(/\/+$/, '');
}

function headers(remote: RemoteDaemon): Record<string, string> {
  return { authorization: `Bearer ${remote.token}` };
}

/** The error of an answer with a status other than 200, as the daemon would raise it. */
async function failure(response: Response): Promise<IpcError> {
  let message = `the server answered ${response.status}`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    if (typeof body.error === 'string') message = body.error;
    code = body.code;
  } catch {
    // keep the status text
  }
  const kind =
    response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : undefined;
  return new IpcError(message, { kind, code });
}

function unreachable(remote: RemoteDaemon, cause: unknown): AppError {
  return new DaemonUnavailable(remote.url, cause);
}

/** A method of the daemon on a server: `POST /api/ipc`. */
export async function remoteRequest(
  remote: RemoteDaemon,
  method: string,
  params: unknown,
  timeoutMs = 30_000,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base(remote)}/api/ipc`, {
      method: 'POST',
      headers: { ...headers(remote), 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw unreachable(remote, error);
  }
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** The events of the server: `GET /api/ipc/events`, one callback per `data:` line. */
export async function remoteSubscribe(
  remote: RemoteDaemon,
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<'closed'> {
  let response: Response;
  try {
    response = await fetch(`${base(remote)}/api/ipc/events`, {
      headers: headers(remote),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted) return 'closed';
    throw unreachable(remote, error);
  }
  if (!response.ok || response.body === null) throw await failure(response);
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) onLine(line.slice('data: '.length));
        }
        end = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw unreachable(remote, error);
  }
  return 'closed';
}
