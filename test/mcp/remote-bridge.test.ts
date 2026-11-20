import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runRemoteBridge } from '../../src/presentation/mcp/remote-bridge.ts';

/** Runs the bridge over the lines; returns what it wrote and the requests it sent. */
async function bridge(
  input: string[],
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: string[] = [];
  stdout.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
  const done = runRemoteBridge({
    token: 'tok',
    server: 'registry',
    input: stdin,
    output: stdout,
    send,
  });
  for (const line of input) stdin.write(`${line}\n`);
  stdin.end();
  await done;
  return written
    .join('')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('remote bridge', () => {
  it('relays every line with the token and the server and writes the answer', async () => {
    const sent: unknown[] = [];
    const out = await bridge(
      [
        '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      ],
      async (method, params) => {
        sent.push({ method, params });
        const message = params.message as { id?: number };
        return {
          message: message.id === undefined ? null : { jsonrpc: '2.0', id: message.id, result: {} },
        };
      },
    );
    expect(sent).toEqual([
      {
        method: 'mcp_remote_forward',
        params: {
          token: 'tok',
          server: 'registry',
          message: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        },
      },
      {
        method: 'mcp_remote_forward',
        params: {
          token: 'tok',
          server: 'registry',
          message: { jsonrpc: '2.0', method: 'notifications/initialized' },
        },
      },
    ]);
    expect(out).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });

  it('answers a broken line and a non-object with a JSON-RPC error and sends nothing', async () => {
    const sent: unknown[] = [];
    const out = await bridge(['not json', '[1]', '5'], async (method) => {
      sent.push(method);
      return { message: null };
    });
    expect(sent).toEqual([]);
    expect(out.map((one) => (one.error as { message: string }).message)).toEqual([
      'parse_error',
      'invalid_request',
      'invalid_request',
    ]);
  });

  it('answers a request with a static code when the daemon is gone, and a notification with nothing', async () => {
    const out = await bridge(
      ['{"jsonrpc":"2.0","id":"a","method":"x"}', '{"jsonrpc":"2.0","method":"y"}'],
      () => Promise.reject(new Error('ECONNREFUSED /secret/path')),
    );
    expect(out).toEqual([
      { jsonrpc: '2.0', id: 'a', error: { code: -32000, message: 'daemon_unavailable' } },
    ]);
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('waits for every answer after the input ended', async () => {
    const out = await bridge(
      ['{"jsonrpc":"2.0","id":1,"method":"x"}', '{"jsonrpc":"2.0","id":2,"method":"x"}'],
      async (_method, params) => {
        const id = (params.message as { id: number }).id;
        await new Promise((resolve) => setTimeout(resolve, id === 1 ? 30 : 0));
        return { message: { jsonrpc: '2.0', id, result: {} } };
      },
    );
    expect(out.map((one) => one.id).sort()).toEqual([1, 2]);
  });
});
