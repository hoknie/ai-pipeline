import type { IncomingMessage, ServerResponse } from 'node:http';

import { request, type DaemonAddress } from '../ipc/client/index.ts';
import type { InboundAnswer } from '../ipc/contract/index.ts';

import { send } from './http.ts';

/** The address of the events of the service registries; the panel never answers another under /hooks/. */
const HOOK_PATH = /^\/hooks\/service-registry\/([A-Za-z0-9._:-]{1,64})$/;

/** The largest body of an event the panel reads; the daemon enforces the same limit again. */
/** The longest value of a signature header; a longer one is refused, never cut. */
const HEADER_LIMIT = 4096;
export const HOOK_BODY_LIMIT = 1024 * 1024;

const HEADERS = ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const;

/** The status and the body of an answer of the daemon: static words, whatever the daemon said. */
function render(answer: InboundAnswer): { status: number; body: Record<string, unknown> } {
  switch (answer.status) {
    case 'applied':
    case 'duplicate':
    case 'ignored':
      return {
        status: 200,
        body: {
          status: answer.status,
          ...(answer.status === 'ignored' && answer.reason !== undefined
            ? { reason: answer.reason }
            : {}),
          ...(answer.status === 'applied' && answer.item !== undefined
            ? { item: answer.item }
            : {}),
          ...(answer.duplicate === true ? { duplicate: true } : {}),
        },
      };
    case 'unknown_outcome':
      return { status: 202, body: { status: 'unknown_outcome' } };
    case 'unauthenticated':
      return { status: 401, body: { error: 'unauthenticated' } };
    case 'too_large':
      return { status: 413, body: { error: 'too_large' } };
    case 'operation_denied':
      return { status: 422, body: { error: 'operation_denied' } };
    default:
      return { status: 503, body: { error: 'unavailable' } };
  }
}

function reply(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  send(response, status, JSON.stringify(body), 'application/json');
}

/** The raw body up to the limit, or null once it is exceeded (the rest is not read). */
async function readBody(incoming: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > HOOK_BODY_LIMIT) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function isHookPath(pathname: string): boolean {
  return pathname.startsWith('/hooks/');
}

/**
 * `POST /hooks/service-registry/<id>`: the events of a service registry. The caller has no token
 * and no session: the daemon checks the signature on the raw bytes. Any other path under `/hooks/`
 * is a 404. The caller checks the host; the origin is not checked, the signature stands for it.
 */
export async function hookRoute(
  socket: DaemonAddress,
  incoming: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const match = HOOK_PATH.exec(new URL(incoming.url ?? '/', 'http://panel').pathname);
  if (match === null) {
    reply(response, 404, { error: 'not_found' });
    return;
  }
  if (incoming.method !== 'POST') {
    response.setHeader('allow', 'POST');
    reply(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const body = await readBody(incoming);
  if (body === null) {
    reply(response, 413, { error: 'too_large' });
    return;
  }
  const headers: Record<string, string> = {};
  for (const name of HEADERS) {
    const value = incoming.headers[name];
    if (typeof value !== 'string') continue;
    if (value.length > HEADER_LIMIT) {
      reply(response, 401, { error: 'unauthenticated' });
      return;
    }
    headers[name] = value;
  }
  let answer: InboundAnswer;
  try {
    answer = (await request(socket, 'integration_inbound', {
      kind: 'service-registry',
      connectionId: match[1] as string,
      body: body.toString('base64'),
      headers,
    })) as InboundAnswer;
  } catch {
    answer = { status: 'unavailable' };
  }
  const { status, body: rendered } = render(answer);
  reply(response, status, rendered);
}
