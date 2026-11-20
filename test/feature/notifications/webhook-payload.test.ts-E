import { describe, expect, it } from 'vitest';

import {
  BODY_LIMIT,
  webhookBody,
  type WebhookEvent,
} from '../../../src/feature/notifications/clients/webhook/payload.ts';
import { signedHeaders } from '../../../src/feature/notifications/clients/webhook/sign.ts';
import { webhookType } from '../../../src/feature/notifications/types/index.ts';

import { eventData } from './helpers.ts';

const AT = Date.UTC(2026, 10, 20, 9, 30, 0);

const event = (patch: Partial<WebhookEvent> = {}): WebhookEvent => ({
  kind: 'question',
  key: 'r1/g/needs_human/1',
  run: 'run000000001',
  data: eventData({ question: 'Which database?', humanOnly: null }),
  at: AT,
  url: null,
  ...patch,
});

const parse = (body: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(body)) as {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  };

describe('webhook body', () => {
  it('has the type, the time in UTC and data of schema 1 with the task and the group', () => {
    const body = parse(webhookBody(event()));
    expect(body).toMatchObject({
      type: 'question.asked',
      timestamp: '2026-11-20T09:30:00.000Z',
      data: {
        schema: 1,
        key: 'r1/g/needs_human/1',
        task: { id: 'run000000001', number: 1, title: 'Task', pipeline: 'feature', project: 'app' },
        group: { slug: 'g', title: 'G', step: 'plan', status: 'needs_human' },
        url: null,
        question: 'Which database?',
        human_only: false,
      },
    });
  });

  it('writes the keys in a fixed order, so the bytes that are signed are stable', () => {
    const text = new TextDecoder().decode(webhookBody(event()));
    expect(text.indexOf('"type"')).toBeLessThan(text.indexOf('"timestamp"'));
    expect(text.indexOf('"timestamp"')).toBeLessThan(text.indexOf('"data"'));
    expect(webhookBody(event())).toEqual(webhookBody(event()));
  });

  it('carries the link of the panel when there is one', () => {
    const body = parse(webhookBody(event({ url: 'https://aip.example.com/#runs/r1/g' })));
    expect(body.data.url).toBe('https://aip.example.com/#runs/r1/g');
  });

  it('maps every kind of delivery to a type of the receiver', () => {
    expect(
      (
        [
          'question',
          'question_closed',
          'failed',
          'conflict',
          'delivery',
          'finished',
          'test',
        ] as const
      ).map(webhookType),
    ).toEqual([
      'question.asked',
      'question.closed',
      'group.failed',
      'group.conflict',
      'delivery.failed',
      'task.finished',
      'webhook.test',
    ]);
  });

  it('puts a structured question as a list with options and the recommendation', () => {
    const data = eventData({
      questions: [{ text: 'DB?', options: ['pg', 'sqlite'], recommendation: 'pg' }],
      humanOnly: 'review',
    });
    const body = parse(webhookBody(event({ data })));
    expect(body.data.question).toEqual([
      { text: 'DB?', options: ['pg', 'sqlite'], recommendation: 'pg' },
    ]);
    expect(body.data.human_only).toBe(true);
  });

  it('tells who closed a question: a person, a bot or the name of a channel', () => {
    const closed = (closure: NonNullable<ReturnType<typeof eventData>['closure']>) =>
      parse(webhookBody(event({ kind: 'question_closed', data: eventData({ closure }) }))).data;
    expect(closed({ by: 'human' })).toMatchObject({ closed: { by: 'human' } });
    expect(closed({ by: 'cancelled' })).toMatchObject({ closed: { by: 'cancelled' } });
    expect(closed({ by: 'channel', channel: 'tg', user: '7' })).toMatchObject({
      closed: { by: 'tg' },
    });
  });

  it('carries the reason of a failure, a conflict and a failed delivery', () => {
    for (const kind of ['failed', 'conflict', 'delivery'] as const) {
      const body = parse(webhookBody(event({ kind, data: eventData({ reason: 'tests failed' }) })));
      expect(body.type).toBe(webhookType(kind));
      expect(body.data.reason).toBe('tests failed');
    }
  });

  it('carries the result of a finished task and how many groups were merged', () => {
    const data = eventData({
      group: null,
      groupTitle: null,
      step: null,
      outcome: 'cancelled',
      merged: 2,
      groups: 3,
    });
    const body = parse(webhookBody(event({ kind: 'finished', data })));
    expect(body.type).toBe('task.finished');
    expect(body.data).toMatchObject({
      result: 'cancelled',
      groups: { merged: 2, total: 3 },
      group: null,
    });
  });

  it('is a test event without a task', () => {
    const body = parse(
      webhookBody(event({ kind: 'test', run: '-', data: eventData({ group: null }) })),
    );
    expect(body.type).toBe('webhook.test');
    expect(body.data.task).toBeNull();
  });

  it('has no absolute path of the machine in what it says', () => {
    const data = eventData({
      reason: 'cannot read /Users/me/work/app/secret/file.txt',
      question: 'Is /home/user/project/src/a.ts right?',
    });
    for (const kind of ['question', 'failed'] as const) {
      const text = new TextDecoder().decode(webhookBody(event({ kind, data })));
      expect(text).not.toContain('/Users/');
      expect(text).not.toContain('/home/');
    }
  });

  it('is cut to 256 KiB with data.truncated when a question is very long', () => {
    const data = eventData({ question: 'long text '.repeat(100_000), questions: null });
    const bytes = webhookBody(event({ data }));
    expect(bytes.byteLength).toBeLessThanOrEqual(BODY_LIMIT);
    expect(parse(bytes).data.truncated).toBe(true);
    expect(parse(webhookBody(event())).data.truncated).toBeUndefined();
  });
});

describe('webhook signature', () => {
  it('matches the reference vector of Standard Webhooks', () => {
    const headers = signedHeaders(
      'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      'msg_p5jXN8AQM9LWM0D4loKWxJek',
      1614265330,
      new TextEncoder().encode('{"test": 2432232314}'),
    );
    expect(headers).toEqual({
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
  });

  it('uses the bytes of a secret that is not whsec_, and changes with the time and the id', () => {
    const body = new TextEncoder().encode('{}');
    const a = signedHeaders('x'.repeat(24), 'msg_1', 100, body)['webhook-signature'];
    expect(signedHeaders('x'.repeat(24), 'msg_1', 100, body)['webhook-signature']).toBe(a);
    expect(signedHeaders('x'.repeat(24), 'msg_1', 101, body)['webhook-signature']).not.toBe(a);
    expect(signedHeaders('x'.repeat(24), 'msg_2', 100, body)['webhook-signature']).not.toBe(a);
    expect(signedHeaders('y'.repeat(24), 'msg_1', 100, body)['webhook-signature']).not.toBe(a);
  });
});
