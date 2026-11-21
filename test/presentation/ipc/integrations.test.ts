import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appError, rejected } from '../../../src/platform/errors/index.ts';
import type { InboundRequest } from '../../../src/feature/integrations/services/index.ts';
import { refusal, type DispatchOutcome } from '../../../src/feature/integrations/types/index.ts';
import {
  MAX_REQUEST_BYTES,
  parseRequest,
  remoteDenied,
  requestSchema,
} from '../../../src/presentation/ipc/contract/index.ts';
import { actionOf } from '../../../src/presentation/ipc/handlers/access/method-actions.ts';
import { handle } from '../../../src/presentation/ipc/handlers/index.ts';
import type { IpcContext } from '../../../src/presentation/ipc/handlers/types.ts';
import { SENTINEL } from '../../feature/integrations/helpers.ts';

const parse = (method: string, params: unknown) =>
  parseRequest(JSON.stringify({ id: 7, method, params }));

describe('integration requests', () => {
  it('accepts the methods with valid parameters', () => {
    for (const [method, params] of [
      ['integration_types', {}],
      ['integration_list', {}],
      ['integration_list', { repository: 'shop' }],
      ['integration_add', { kind: 'example', name: 'main', global: true, params: { a: 'b' } }],
      ['integration_add', { kind: 'example', name: 'main', repository: '/repo' }],
      ['integration_remove', { id: 'c1' }],
      ['integration_enable', { id: 'c1' }],
      ['integration_disable', { id: 'c1' }],
      ['integration_check', { id: 'c1' }],
      ['integration_senders', { id: 'c1' }],
      ['integration_skills', { id: 'c1', query: 'go' }],
      ['integration_skills', { repository: '/repo' }],
      ['integration_secret_set', { id: 'c1', slot: 'token', value: 'v' }],
      ['integration_secret_remove', { id: 'c1', slot: 'token' }],
    ] as const) {
      expect(parse(method, params)).toMatchObject({ request: { method } });
    }
  });

  it('needs a connection id for the recent senders, and the right to read integrations', () => {
    for (const params of [{}, { id: '' }, { id: 'x'.repeat(65) }]) {
      expect(parse('integration_senders', params)).toMatchObject({ code: 'invalid_params' });
    }
    expect(actionOf('integration_senders', { id: 'c1' })).toBe('integration.read');
  });

  it('refuses a slot that is not a name, an empty or oversized value and extra shapes', () => {
    for (const params of [
      { id: 'c1', slot: 'Bad Slot', value: 'v' },
      { id: 'c1', slot: 'token', value: '' },
      { id: 'c1', slot: 'token', value: 'x'.repeat(16 * 1024 + 1) },
      { id: 'c1', slot: 'token' },
    ]) {
      expect(parse('integration_secret_set', params)).toMatchObject({
        id: 7,
        code: 'invalid_params',
      });
    }
  });

  it('has no method that reads a secret back', () => {
    const methods = requestSchema.options.map((option) => option.shape.method.value);
    expect(methods.filter((method) => method.startsWith('integration_')).sort()).toEqual([
      'integration_add',
      'integration_check',
      'integration_disable',
      'integration_edit',
      'integration_enable',
      'integration_inbound',
      'integration_link',
      'integration_links',
      'integration_list',
      'integration_remove',
      'integration_secret_remove',
      'integration_secret_set',
      'integration_senders',
      'integration_skills',
      'integration_types',
    ]);
  });
});

describe('fixed errors', () => {
  const broken: [string, string][] = [
    ['invalid JSON', `{"id":1,"value":"${SENTINEL}"`],
    ['no method', JSON.stringify({ id: 1, params: { value: SENTINEL } })],
    ['method of another type', JSON.stringify({ id: 1, method: { SENTINEL }, params: {} })],
    ['unknown method', JSON.stringify({ id: 1, method: SENTINEL, params: {} })],
    ['not an object', JSON.stringify([SENTINEL])],
    [
      'wrong params of a secret method',
      JSON.stringify({ id: 1, method: 'integration_secret_set', params: { value: 5, SENTINEL } }),
    ],
    [
      'wrong params of an ordinary method',
      JSON.stringify({ id: 1, method: 'tags', params: { repository: [SENTINEL] } }),
    ],
  ];

  it.each(broken)('says nothing of the input: %s', (_name, line) => {
    const parsed = parseRequest(line);
    expect('error' in parsed).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain(SENTINEL);
    expect(JSON.stringify(parsed)).not.toContain('Invalid');
    expect(Object.keys(parsed).sort()).toEqual(['code', 'error', 'id']);
  });

  it('refuses a line above the limit without parsing it', () => {
    const line = `{"id":1,"method":"ping","params":{"x":"${'x'.repeat(MAX_REQUEST_BYTES)}"}}`;
    expect(parseRequest(line)).toEqual({
      id: -1,
      error: 'request is too large',
      code: 'request_too_large',
    });
  });
});

describe('integration handlers', () => {
  const context = (thrown: unknown): IpcContext =>
    ({
      actor: { kind: 'local' },
      services: {
        integrations: {
          connections: {
            types: () => {
              throw thrown;
            },
            list: () => Promise.reject(thrown),
          },
        },
      },
    }) as unknown as IpcContext;

  it('replaces any exception by a fixed refusal and keeps the refusals of the integrations', async () => {
    const hostile = Object.assign(new Error(`boom ${SENTINEL}`), { cause: SENTINEL });
    for (const thrown of [
      hostile,
      rejected(`path ${SENTINEL}`),
      appError('internal', 'x.y', SENTINEL),
    ]) {
      const request = { method: 'integration_list', params: {} } as const;
      const error = await handle(request, context(thrown)).catch((caught: Error) => caught);
      expect((error as Error).message).toBe('integration request failed');
      expect(JSON.stringify(error)).not.toContain(SENTINEL);
    }
    const kept = await handle(
      { method: 'integration_types', params: {} },
      context(refusal('not_found')),
    ).catch((caught: Error) => caught);
    expect((kept as Error).message).toBe('connection not found');
  });
});

describe('the recent senders handler', () => {
  const senders = [{ user: '222', label: '@bob', at: 5 }];
  const context = (forConnection: (id: string) => unknown): IpcContext =>
    ({
      actor: { kind: 'local' },
      services: { notifications: { senders: { forConnection } } },
    }) as unknown as IpcContext;

  it('answers with the people the service lists', async () => {
    const asked: string[] = [];
    const answer = await handle(
      { method: 'integration_senders', params: { id: 'c1' } },
      context((id) => (asked.push(id), senders)),
    );
    expect(answer).toEqual(senders);
    expect(asked).toEqual(['c1']);
  });

  it('keeps the refusal of an unknown connection and hides any other failure', async () => {
    const request = { method: 'integration_senders', params: { id: 'c1' } } as const;
    const unknown = await handle(
      request,
      context(() => {
        throw refusal('not_found');
      }),
    ).catch((caught: Error) => caught);
    expect((unknown as Error).message).toBe('connection not found');
    const other = await handle(
      request,
      context(() => {
        throw new Error(`boom ${SENTINEL}`);
      }),
    ).catch((caught: Error) => caught);
    expect((other as Error).message).toBe('integration request failed');
  });
});

describe('where the methods are not offered', () => {
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? sources(path) : [path];
    });
  }

  it('has no MCP tool, and no panel route that touches secrets', () => {
    const root = join(import.meta.dirname, '..', '..', '..', 'src', 'presentation');
    const own = join('web', 'routes', 'integrations', 'integrations.ts');
    for (const place of ['mcp', 'web']) {
      for (const file of sources(join(root, place))) {
        const text = readFileSync(file, 'utf8');
        if (file.endsWith(own)) {
          // the panel manages connections and their non-secret parameters; secrets stay with the CLI
          expect(text, file).not.toMatch(/integration_secret_(set|remove)/);
          expect(text, file).toContain('integration_senders');
        } else if (file.endsWith(join('web', 'hooks.ts'))) {
          // the route of the events of registries carries one method and no other
          expect(text, file).not.toMatch(/integration_(?!inbound)/);
        } else {
          expect(text, file).not.toMatch(/integration_/);
        }
      }
    }
  });
});

describe('integration_inbound', () => {
  const valid = {
    kind: 'service-registry',
    connectionId: 'c1',
    body: Buffer.from('{}').toString('base64'),
    headers: { 'webhook-id': 'm1', 'webhook-timestamp': '1', 'webhook-signature': 'v1,AA==' },
  };

  it('takes the three headers of the scheme and a body up to 1 MiB, nothing more', () => {
    expect(parse('integration_inbound', valid)).toMatchObject({
      request: { method: 'integration_inbound' },
    });
    for (const params of [
      { ...valid, headers: { ...valid.headers, authorization: 'Bearer x' } },
      { ...valid, headers: { 'webhook-id': 'x'.repeat(4097) } },
      { ...valid, body: 'A'.repeat(1_398_105) },
      { ...valid, kind: 'example' },
      { ...valid, connectionId: '' },
    ]) {
      expect(parse('integration_inbound', params)).toMatchObject({ code: 'invalid_params' });
    }
    expect(parse('integration_inbound', { ...valid, body: 'A'.repeat(1_398_104) })).toMatchObject({
      request: { method: 'integration_inbound' },
    });
  });

  it('is refused to the remote transport and needs no user', () => {
    expect(remoteDenied).toContain('integration_inbound');
    expect(actionOf('integration_inbound', valid)).toBeNull();
  });

  const run = async (receive: (request: InboundRequest) => Promise<DispatchOutcome>) => {
    const lines: string[] = [];
    const received: InboundRequest[] = [];
    const answer = await handle(
      { method: 'integration_inbound', params: valid } as never,
      {
        actor: { kind: 'system' },
        log: (line: string) => lines.push(line),
        services: {
          integrations: {
            inbound: {
              receive: (request: InboundRequest) => {
                received.push(request);
                return receive(request);
              },
            },
          },
        },
      } as unknown as IpcContext,
    );
    return { answer, lines, received };
  };

  it('decodes the body, calls the gate and answers in static words with one log line', async () => {
    const { answer, lines, received } = await run((request) => {
      request.onVerified?.({ type: 'deployment.drift', path: 'acme/api' });
      return Promise.resolve({
        status: 'applied',
        connectionId: 'c1',
        result: { queued: true, item: 'q7' },
      });
    });
    expect(answer).toEqual({ status: 'applied', item: 'q7' });
    expect(received[0]).toMatchObject({ verifier: 'service-registry', connectionId: 'c1' });
    expect(Buffer.from(received[0]!.body).toString()).toBe('{}');
    expect(lines).toEqual([
      'integration event: connection=c1 type=deployment.drift path=acme/api outcome=applied',
    ]);
    expect(lines.join('\n')).not.toContain('v1,AA==');
  });

  it('reports a skipped repeat, an ignored event and an unknown outcome', async () => {
    const skipped = await run(() =>
      Promise.resolve({
        status: 'applied',
        connectionId: 'c1',
        result: { queued: false, duplicate: true },
      }),
    );
    expect(skipped.answer).toEqual({ status: 'applied', duplicate: true });
    const ignored = await run((request) => {
      request.onVerified?.({ type: 'repo_sync.recovered', path: 'acme/api' });
      return Promise.resolve({ status: 'ignored', connectionId: 'c1', reason: 'recovery' });
    });
    expect(ignored.answer).toEqual({ status: 'ignored', reason: 'recovery' });
    expect(ignored.lines[0]).toContain('outcome=ignored recovery');
    const again = await run(() =>
      Promise.resolve({ status: 'duplicate', connectionId: 'c1', result: { item: 'q1' } }),
    );
    expect(again.answer).toEqual({ status: 'duplicate' });
    const unknown = await run(() =>
      Promise.resolve({ status: 'unknown_outcome', connectionId: 'c1' }),
    );
    expect(unknown.answer).toEqual({ status: 'unknown_outcome' });
  });

  it('gives one answer for every kind of failed authentication and keeps the rest apart', async () => {
    const answers = [];
    for (const code of ['unauthenticated', 'disabled', 'not_found'] as const) {
      answers.push((await run(() => Promise.reject(refusal(code)))).answer);
    }
    expect(new Set(answers.map((one) => JSON.stringify(one)))).toEqual(
      new Set([JSON.stringify({ status: 'unauthenticated' })]),
    );
    const cases: [unknown, string][] = [
      [refusal('too_large'), 'too_large'],
      [refusal('operation_denied'), 'operation_denied'],
      [refusal('timeout'), 'unavailable'],
      [refusal('backend_unavailable'), 'unavailable'],
      [new Error(`boom ${SENTINEL}`), 'unavailable'],
    ];
    for (const [thrown, status] of cases) {
      const { answer, lines } = await run(() => Promise.reject(thrown));
      expect(answer).toEqual({ status });
      expect(lines.join()).not.toContain(SENTINEL);
    }
  });
});
