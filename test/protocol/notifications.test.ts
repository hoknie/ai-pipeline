import { describe, expect, it } from 'vitest';

import { appError, rejected } from '../../src/platform/errors/index.ts';
import { notificationRefusal } from '../../src/feature/notifications/types/index.ts';
import { parseRequest, requestSchema } from '../../src/presentation/ipc/contract/index.ts';
import { handle } from '../../src/presentation/ipc/handlers/index.ts';
import type { IpcContext } from '../../src/presentation/ipc/handlers/types.ts';
import { channelView } from '../../src/presentation/ipc/views/index.ts';
import { SENTINEL } from '../feature/integrations/helpers.ts';

const parse = (method: string, params: unknown) =>
  parseRequest(JSON.stringify({ id: 7, method, params }));

describe('notification requests', () => {
  it('accepts the methods with valid parameters', () => {
    for (const [method, params] of [
      ['notify_list', {}],
      ['notify_list', { repository: '/repo' }],
      ['notify_add', { connection: 'c1', allProjects: true }],
      ['notify_add', { connection: 'c1', repository: '/repo', events: ['question', 'failed'] }],
      ['notify_edit', { id: 'n1', events: ['finished'] }],
      ['notify_enable', { id: 'n1' }],
      ['notify_disable', { id: 'n1' }],
      ['notify_remove', { id: 'n1' }],
      ['notify_test', { id: 'n1' }],
      ['notify_log', {}],
      ['notify_log', { subscription: 'n1', state: 'failed', limit: 50 }],
      ['notify_channels', {}],
    ] as const) {
      expect(parse(method, params)).toMatchObject({ request: { method } });
    }
  });

  it('refuses malformed parameters without echoing them', () => {
    for (const [method, params] of [
      ['notify_add', {}],
      ['notify_add', { connection: '' }],
      ['notify_edit', { id: 'n1' }],
      ['notify_edit', { id: 'n1', events: [SENTINEL.repeat(20)] }],
      ['notify_log', { limit: 0 }],
      ['notify_log', { limit: 1000 }],
      ['notify_remove', { id: 5 }],
    ] as const) {
      const parsed = parse(method, params);
      expect(parsed).toMatchObject({ id: 7, code: 'invalid_params' });
      expect(JSON.stringify(parsed)).not.toContain(SENTINEL);
    }
  });

  it('has only the methods of subscriptions, none that carries a secret', () => {
    const methods = requestSchema.options
      .map((option) => option.shape.method.value)
      .filter((method) => method.startsWith('notify_'));
    expect(methods.sort()).toEqual([
      'notify_add',
      'notify_channels',
      'notify_disable',
      'notify_edit',
      'notify_enable',
      'notify_list',
      'notify_log',
      'notify_remove',
      'notify_test',
    ]);
  });
});

describe('notification handlers', () => {
  const context = (thrown: unknown): IpcContext =>
    ({
      actor: { kind: 'local' },
      services: {
        notifications: {
          subscriptions: {
            list: () => {
              throw thrown;
            },
          },
          dispatcher: { test: () => Promise.reject(thrown) },
          journal: { list: () => [] },
        },
        integrations: { connections: { list: () => Promise.reject(thrown) } },
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
        { method: 'notify_list', params: {} },
        { method: 'notify_test', params: { id: 'n1' } },
        { method: 'notify_channels', params: {} },
      ];
      for (const request of requests) {
        const error = await handle(request, context(thrown)).catch((caught: Error) => caught);
        expect((error as Error).message).toBe('integration request failed');
        expect(JSON.stringify(error)).not.toContain(SENTINEL);
      }
    }
    const kept = await handle(
      { method: 'notify_test', params: { id: 'n1' } },
      context(notificationRefusal('channel_failed')),
    ).catch((caught: Error) => caught);
    expect((kept as Error).message).toBe('the channel did not accept the message');
  });

  it('refuses a state of the journal that does not exist', async () => {
    const error = await handle(
      { method: 'notify_log', params: { state: 'bogus' } },
      context(null),
    ).catch((caught: Error) => caught);
    expect((error as Error).message).toBe('subscription not found');
  });
});

describe('views of the channels', () => {
  it('carry a state and a safe text, nothing else', () => {
    expect(channelView({ state: 'listening' }, 'c1')).toEqual({
      connection: 'c1',
      state: 'listening',
      error: null,
      unauthorized: false,
    });
    expect(channelView({ state: 'error', error: 'bad token', unauthorized: true }, 'c1')).toEqual({
      connection: 'c1',
      state: 'error',
      error: 'bad token',
      unauthorized: true,
    });
  });
});
