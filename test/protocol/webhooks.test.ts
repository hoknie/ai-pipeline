import { describe, expect, it } from 'vitest';

import { appError, rejected } from '../../src/platform/errors/index.ts';
import { notificationRefusal } from '../../src/feature/notifications/types/index.ts';
import { parseRequest, requestSchema } from '../../src/presentation/ipc/contract/index.ts';
import { handle } from '../../src/presentation/ipc/handlers/index.ts';
import type { IpcContext } from '../../src/presentation/ipc/handlers/types.ts';
import { SENTINEL } from '../feature/integrations/helpers.ts';

const parse = (method: string, params: unknown) =>
  parseRequest(JSON.stringify({ id: 7, method, params }));

describe('webhook requests', () => {
  it('accepts the methods with valid parameters', () => {
    for (const [method, params] of [
      ['webhook_list', {}],
      ['webhook_list', { repository: '/repo' }],
      ['webhook_add', { name: 'ci', url: 'https://ci.example.com/hook', allProjects: true }],
      [
        'webhook_add',
        {
          name: 'ci',
          url: 'http://127.0.0.1:8080/hook',
          repository: '/repo',
          events: ['question'],
        },
      ],
      ['webhook_edit', { id: 'c1', url: 'https://ci.example.com/v2' }],
      ['webhook_edit', { id: 'c1', events: ['finished'] }],
      ['webhook_enable', { id: 'c1' }],
      ['webhook_disable', { id: 'c1' }],
      ['webhook_remove', { id: 'c1' }],
      ['webhook_test', { id: 'c1' }],
      ['webhook_log', { id: 'c1' }],
      ['webhook_log', { id: 'c1', state: 'failed', limit: 50 }],
      ['webhook_redeliver', { id: 12 }],
    ] as const) {
      expect(parse(method, params)).toMatchObject({ request: { method } });
    }
  });

  it('refuses malformed parameters without echoing them', () => {
    for (const [method, params] of [
      ['webhook_add', {}],
      ['webhook_add', { name: 'ci', url: SENTINEL.repeat(200) }],
      ['webhook_edit', { url: 'https://x.example.com' }],
      ['webhook_log', { id: 'c1', limit: 0 }],
      ['webhook_log', { id: 'c1', state: SENTINEL }],
      ['webhook_redeliver', { id: 'c1' }],
      ['webhook_remove', { id: 5 }],
    ] as const) {
      const parsed = parse(method, params);
      expect(parsed).toMatchObject({ id: 7, code: 'invalid_params' });
      expect(JSON.stringify(parsed)).not.toContain(SENTINEL);
    }
  });

  it('has no method that takes a secret', () => {
    const methods = requestSchema.options
      .map((option) => option.shape.method.value)
      .filter((method) => method.startsWith('webhook_'));
    expect(methods.sort()).toEqual([
      'webhook_add',
      'webhook_disable',
      'webhook_edit',
      'webhook_enable',
      'webhook_list',
      'webhook_log',
      'webhook_redeliver',
      'webhook_remove',
      'webhook_test',
    ]);
    expect(
      JSON.stringify(
        parse('webhook_add', {
          name: 'ci',
          url: 'https://a.example.com',
          signing_secret: SENTINEL,
        }),
      ),
    ).not.toContain(SENTINEL);
  });
});

describe('webhook handlers', () => {
  const context = (thrown: unknown): IpcContext =>
    ({
      actor: { kind: 'local' },
      services: {
        notifications: {
          webhooks: {
            list: () => Promise.reject(thrown),
            test: () => Promise.reject(thrown),
            redeliver: () => {
              throw thrown;
            },
            log: () => [],
          },
        },
      },
    }) as unknown as IpcContext;

  it('replaces any exception by a fixed refusal and keeps the refusals of the notifications', async () => {
    const hostile = Object.assign(new Error(`boom ${SENTINEL}`), { cause: SENTINEL });
    for (const thrown of [
      hostile,
      rejected(`path ${SENTINEL}`),
      appError('internal', 'x.y', SENTINEL),
    ]) {
      const requests: Parameters<typeof handle>[0][] = [
        { method: 'webhook_list', params: {} },
        { method: 'webhook_test', params: { id: 'c1' } },
        { method: 'webhook_redeliver', params: { id: 3 } },
      ];
      for (const request of requests) {
        const error = await handle(request, context(thrown)).catch((caught: Error) => caught);
        expect((error as Error).message).toBe('integration request failed');
        expect(JSON.stringify(error)).not.toContain(SENTINEL);
      }
    }
    const kept = await handle(
      { method: 'webhook_redeliver', params: { id: 3 } },
      context(notificationRefusal('not_redeliverable')),
    ).catch((caught: Error) => caught);
    expect((kept as Error).message).toBe('only a sent or failed delivery can be sent again');
  });

  it('refuses a state of the journal that does not exist', async () => {
    // a state outside the table is stopped by the request schema, a handler call by the handler
    const error = await handle(
      { method: 'webhook_log', params: { id: 'c1', state: 'bogus' } },
      context(null),
    ).catch((caught: Error) => caught);
    expect((error as Error).message).toBe('subscription not found');
  });
});

describe('what the answers show', () => {
  it('lists a webhook with the address the service shows and never a secret', async () => {
    const view = {
      id: 'c1',
      name: 'ci',
      url: 'https://ci.example.com/hook',
      project: null,
      events: ['question'],
      enabled: true,
      secret: true,
      disabledReason: null,
      failureStreak: 0,
    };
    const answer = await handle({ method: 'webhook_list', params: {} }, {
      actor: { kind: 'local' },
      services: { notifications: { webhooks: { list: () => Promise.resolve([view]) } } },
    } as unknown as IpcContext);
    expect(JSON.stringify(answer)).not.toMatch(/token|signing_secret|whsec/);
    expect(answer).toEqual([expect.objectContaining({ id: 'c1', secret: true })]);
  });

  it('lists the connection of a webhook of the integrations without the query of its address', async () => {
    const connection = {
      id: 'c1',
      kind: 'webhook',
      name: 'ci',
      scope: 'global',
      project: null,
      params: { url: 'https://ci.example.com/hook?token=abc#frag' },
      enabled: true,
      state: 'ready',
      secrets: [{ slot: 'signing_secret', required: true, present: true }],
      pending: false,
    };
    const answer = await handle({ method: 'integration_list', params: {} }, {
      actor: { kind: 'local' },
      services: {
        integrations: { connections: { list: () => Promise.resolve([connection]) } },
        notifications: { channels: { statusOf: () => null } },
      },
    } as unknown as IpcContext);
    expect(JSON.stringify(answer)).not.toContain('token=abc');
    expect(JSON.stringify(answer)).toContain('https://ci.example.com/hook');
  });
});
