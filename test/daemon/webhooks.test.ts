import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import type { WebhookView } from '../../src/presentation/ipc/contract/index.ts';
import { startReceiver, type FakeReceiver } from '../fakes/webhook-receiver.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';

import { run } from './control-harness.ts';
import { harness, until, type Harness } from './harness.ts';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

let hook: FakeReceiver | null = null;
let daemon: Harness | null = null;

afterEach(async () => {
  await daemon?.close();
  await hook?.close();
  daemon = null;
  hook = null;
});

async function start() {
  hook = await startReceiver();
  daemon = await harness(undefined, undefined, {
    integrations: { secretStore: new MemoryStore() },
  });
  await daemon.call('repository_add', { path: daemon.repo });
  return { h: daemon, receiver: hook };
}

async function connect(h: Harness, receiver: FakeReceiver, events?: string[]) {
  const added = (await h.call('webhook_add', {
    name: 'ci',
    url: `${receiver.base}/hook?token=abc`,
    allProjects: true,
    ...(events === undefined ? {} : { events }),
  })) as WebhookView;
  await h.call('integration_secret_set', { id: added.id, slot: 'signing_secret', value: SECRET });
  await h.call('webhook_enable', { id: added.id });
  return added;
}

const QUESTIONS = [
  { text: 'OAuth or password?', options: ['OAuth', 'password'], recommendation: 'OAuth' },
];

describe('webhooks of a daemon', () => {
  it('sends the question signed, then the closing of it after the answer in the panel', async () => {
    const { h, receiver } = await start();
    const added = await connect(h, receiver, ['question']);
    expect(added).toMatchObject({ enabled: false, secret: false, url: `${receiver.base}/hook` });
    h.script({ code: [{ verdict: 'needs_human', questions: QUESTIONS }, {}] });
    const runId = await run(h);

    await receiver.waitFor(1);
    const [asked] = receiver.received;
    expect(asked?.path).toBe('/hook?token=abc');
    const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
    const id = asked!.headers['webhook-id'];
    const stamp = asked!.headers['webhook-timestamp'];
    const expected = createHmac('sha256', key)
      .update(`${id}.${stamp}.${asked!.body}`)
      .digest('base64');
    expect(asked!.headers['webhook-signature']).toBe(`v1,${expected}`);
    const body = JSON.parse(asked!.body);
    expect(body).toMatchObject({
      type: 'question.asked',
      data: { schema: 1, task: { id: runId } },
    });
    expect(body.data.question[0].text).toBe('OAuth or password?');
    expect(asked!.body).not.toContain(h.repo);

    await h.call('answer', { runId, group: 'g1', answer: 'Q1: OAuth\nA1: OAuth' });
    await receiver.waitFor(2);
    const closed = JSON.parse(receiver.received[1]!.body);
    expect(closed).toMatchObject({ type: 'question.closed', data: { closed: { by: 'human' } } });
    expect(receiver.received[1]!.headers['webhook-id']).not.toBe(id);
    await h.waitFor(runId, (view) => view.finished);

    const log = (await h.call('webhook_log', { id: added.id })) as {
      state: string;
      type: string;
    }[];
    expect(log.map((one) => [one.type, one.state]).sort()).toEqual([
      ['question.asked', 'closed'],
      ['question.closed', 'sent'],
    ]);
    expect(JSON.stringify(await h.call('integration_list', {}))).not.toContain('token=abc');
  });

  it('retries a refused call, tests the webhook and switches it off after 410', async () => {
    const { h, receiver } = await start();
    const added = await connect(h, receiver, ['question']);
    const tested = (await h.call('webhook_test', { id: added.id })) as { ok: boolean };
    expect(tested.ok).toBe(true);
    expect(JSON.parse(receiver.received[0]!.body).type).toBe('webhook.test');

    receiver.answers.push({ status: 410 });
    h.script({ code: [{ verdict: 'needs_human', questions: QUESTIONS }, {}] });
    await run(h);
    await until('the webhook goes off', async () => {
      const [view] = (await h.call('webhook_list', {})) as WebhookView[];
      return view?.enabled === false;
    });
    const [view] = (await h.call('webhook_list', {})) as WebhookView[];
    expect(view?.disabledReason).toBe('the receiver answered 410 Gone');
  });
});
