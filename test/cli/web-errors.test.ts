import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PanelError, renderPanelError, type PanelKind } from '../../src/presentation/web/errors.ts';
import { appError, rejected } from '../../src/platform/errors/index.ts';
import { DaemonUnavailable, IpcError } from '../../src/presentation/ipc/client/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';

let web: WebServer | null = null;
let fake: Server | null = null;

afterEach(async () => {
  await web?.close();
  await new Promise<void>((resolve) => (fake ? fake.close(() => resolve()) : resolve()));
  web = null;
  fake = null;
});

/** A daemon socket whose answer to every request (but `subscribe`) is the given raw line. */
async function panel(answer: string | null): Promise<{ base: string; token: string }> {
  const socket = join(mkdtempSync(join(tmpdir(), 'aip-we-')), 'd.sock');
  if (answer !== null) {
    fake = createServer((connection) => {
      connection.setEncoding('utf8');
      connection.on('error', () => undefined);
      connection.on('data', (chunk: string) => {
        const message = JSON.parse(chunk.split('\n')[0] ?? '{}') as { method?: string };
        if (message.method === 'subscribe') return;
        connection.write(`${answer}\n`);
      });
    });
    await new Promise<void>((resolve) => fake?.listen(socket, resolve));
  }
  web = await startWebServer({
    socket,
    port: 0,
    ensureDaemon: async () => ({ mismatch: null }) as never,
  });
  return { base: `http://127.0.0.1:${web.port}`, token: web.token ?? '' };
}

function failed(error: string): string {
  return JSON.stringify({ id: 1, ok: false, error });
}

async function status(answer: string | null): Promise<{ status: number; error: string }> {
  const { base, token } = await panel(answer);
  const response = await fetch(`${base}/api/runs`, { headers: { 'x-aip-token': token } });
  const body = (await response.json()) as { error: string };
  return { status: response.status, error: body.error };
}

describe('panel statuses of daemon errors', () => {
  it.each([
    ['unknown run `r1`', 404],
    ['unknown group `g` in run r1', 404],
    ['unknown attempt 3 of group `g`', 404],
    ['unknown queue item', 404],
    ['unknown artifact `a`', 404],
    ['not a background process: 12', 404],
    ['`a.ts` is not changed in group g', 404],
    ['run r1 has no merged changes', 409],
    ['the diff of group g is not available', 409],
    ['aip daemon did not answer status within 30000 ms', 504],
    ['malformed response from aip daemon', 502],
    ['run is already paused', 400],
  ])('%s → %i, text unchanged', async (text, code) => {
    expect(await status(failed(text))).toEqual({ status: code, error: text });
  });

  it('answers 502 for a malformed reply of the daemon', async () => {
    const result = await status('{"nonsense":true}');
    expect(result.status).toBe(502);
    expect(result.error).toBe('malformed response from aip daemon');
  });

  it('answers 502 when the daemon is not reachable', async () => {
    const result = await status(null);
    expect(result.status).toBe(502);
    expect(result.error).toContain('aip daemon is not reachable at');
  });
});

describe('panel error rendering', () => {
  const kinds: [PanelKind, number][] = [
    ['invalid', 400],
    ['unauthorized', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['method_not_allowed', 405],
    ['conflict', 409],
    ['too_large', 413],
    ['unsupported', 415],
  ];

  it.each(kinds)('maps the kind %s to %i', (kind, code) => {
    expect(renderPanelError(new PanelError(kind, 'text'))).toEqual({
      status: code,
      body: { error: 'text' },
    });
  });

  it('puts the responseCode into the body only when it is set', () => {
    expect(renderPanelError(new PanelError('conflict', 'busy', 'daemon_busy')).body).toEqual({
      error: 'busy',
      code: 'daemon_busy',
    });
  });

  it('answers 502 to an app error of another area, whatever its kind', () => {
    expect(renderPanelError(rejected('no'))).toEqual({ status: 502, body: { error: 'no' } });
    expect(renderPanelError(appError('not_found', 'git.x', 'gone')).status).toBe(502);
    expect(renderPanelError(new DaemonUnavailable('/s', new Error('x'))).status).toBe(502);
    expect(renderPanelError(new Error('plain')).status).toBe(502);
  });

  it('checks IpcError first: its text decides, not its kind', () => {
    expect(renderPanelError(new IpcError('unknown run `r`')).status).toBe(404);
    expect(renderPanelError(new IpcError('anything else')).status).toBe(400);
  });
});
