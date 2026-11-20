import { afterEach, describe, expect, it } from 'vitest';

import { startReceiver } from '../../fakes/webhook-receiver.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';

import { RETRY_MS } from '../../../src/feature/notifications/services/sender.ts';

import {
  asking,
  chatConnection,
  group,
  finish,
  harness,
  permanent,
  step,
  temporary,
  type Harness,
} from './helpers.ts';

let current: Harness | null = null;
afterEach(async () => {
  await current?.close();
  current = null;
});

const QUESTIONS = [
  { text: 'Which database?', options: ['SQLite', 'PostgreSQL'], recommendation: 'PostgreSQL' },
];

/** A harness with an enabled shared connection and a subscription of project `app`. */
async function subscribed(
  events: string[] = ['question'],
  params?: Record<string, string>,
  start = true,
) {
  const h = harness({ start });
  current = h;
  const connection = await chatConnection(h.base, params === undefined ? {} : { params });
  const subscription = await h.notifications.subscriptions.add({
    connection,
    repository: 'app',
    events,
  });
  return { h, connection, subscription };
}

describe('sending a question', () => {
  it('sends one message with the question, its options and the buttons', async () => {
    const { h, connection } = await subscribed();
    await h.save(asking(QUESTIONS));
    const sent = h.channels.of(connection).sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message.questions[0]?.options.map((option) => option.text)).toEqual([
      'SQLite',
      'PostgreSQL',
    ]);
    expect(sent[0]?.message.rows.length).toBe(2);
    const [delivery] = h.notifications.journal.list({});
    expect(delivery).toMatchObject({
      state: 'sent',
      attempts: 1,
      kind: 'question',
      group: 'group-1',
    });
  });

  it('sends it once however many times the run is saved', async () => {
    const { h, connection } = await subscribed();
    const state = asking(QUESTIONS);
    await h.save(state);
    await h.save(state);
    await h.save(state);
    expect(h.channels.of(connection).sent).toHaveLength(1);
  });

  it('sends the same question once after a restart of the daemon', async () => {
    const { h, connection } = await subscribed();
    const state = asking(QUESTIONS);
    await h.save(state);
    const first = h.channels.of(connection).sent.length;
    const again = h.restart();
    await again.dispatcher.start();
    expect(h.channels.of(connection).sent.length).toBe(first);
    expect(h.notifications.journal.list({})).toHaveLength(1);
  });

  it('catches up with a question asked while the daemon was off', async () => {
    const { h, connection } = await subscribed(['question'], undefined, false);
    h.states.set('run000000001', asking(QUESTIONS));
    expect(h.channels.sentTotal()).toBe(0);
    await h.notifications.dispatcher.start();
    expect(h.channels.of(connection).sent).toHaveLength(1);
  });

  it('sends the second question of a new attempt as a new message', async () => {
    const { h, connection } = await subscribed();
    const state = asking(QUESTIONS);
    await h.save(state);
    transition(state, { kind: 'answer', group: 'group-1', answer: 'A', by: 'human' }, 2000);
    await h.save(state);
    step(state, 3000);
    finish(state, 'needs_human', { questions: [{ text: 'Again?' }], now: 4000 });
    await h.save(state);
    expect(h.channels.of(connection).sent).toHaveLength(2);
    expect(h.notifications.journal.list({ state: 'closed' })).toHaveLength(1);
  });

  it('sends nothing without a subscription and nothing after a disable', async () => {
    const { h, connection, subscription } = await subscribed();
    h.notifications.subscriptions.disable(subscription.id);
    await h.save(asking(QUESTIONS));
    expect(h.channels.sentTotal()).toBe(0);
    expect(connection).toBeDefined();
  });

  it('sends to two subscriptions, one message each', async () => {
    const { h, connection } = await subscribed();
    const second = await chatConnection(h.base, { name: 'second', params: { chat_id: '-200' } });
    await h.notifications.subscriptions.add({ connection: second, allProjects: true });
    await h.save(asking(QUESTIONS));
    expect(h.channels.of(connection).sent).toHaveLength(1);
    expect(h.channels.of(second).sent).toHaveLength(1);
    expect(h.channels.of(second).sent[0]?.ref.chat_id).toBe('-200');
  });

  it('puts a link to the group in the message only with a public url', async () => {
    const { h, connection } = await subscribed();
    await h.save(asking(QUESTIONS));
    expect(h.channels.of(connection).sent[0]?.message.link).toBeNull();
    const linked = harness({ settings: 'web: { public_url: "https://aip.example.com/" }\n' });
    current = linked;
    const id = await chatConnection(linked.base);
    await linked.notifications.subscriptions.add({ connection: id, repository: 'app' });
    await linked.save(asking(QUESTIONS, { id: 'mwky60yww0dh' }));
    expect(linked.channels.of(id).sent[0]?.message.link).toBe(
      'https://aip.example.com/#runs/mwky60yww0dh/group-1',
    );
    await h.close();
  });
});

describe('the other events', () => {
  it('sends a failure without buttons and the end of a task', async () => {
    const { h, connection } = await subscribed(['failed', 'finished']);
    const state = asking(null);
    state.groups[0]!.status = 'failed';
    state.groups[0]!.reason = 'tests are red';
    state.run.finishedAt = 9000;
    await h.save(state);
    const sent = h.channels.of(connection).sent.map((one) => one.message);
    expect(sent.map((message) => message.kind).sort()).toEqual(['failed', 'finished']);
    expect(sent.every((message) => message.rows.length === 0)).toBe(true);
  });
});

describe('retries', () => {
  it('retries a temporary refusal with growing pauses and sends once', async () => {
    const { h, connection } = await subscribed();
    const channel = h.channels.of(connection);
    channel.failures = [temporary('bad gateway'), temporary('bad gateway')];
    await h.save(asking(QUESTIONS));
    expect(h.notifications.journal.list({ state: 'pending' })).toMatchObject([
      { attempts: 1, error: 'bad gateway' },
    ]);
    h.clock.time += RETRY_MS[0]! - 1;
    await h.notifications.dispatcher.flush();
    expect(h.notifications.journal.list({ state: 'pending' })).toHaveLength(1);
    h.clock.time += 1;
    await h.notifications.dispatcher.flush();
    expect(h.notifications.journal.list({ state: 'pending' })[0]?.attempts).toBe(2);
    h.clock.time += RETRY_MS[1]!;
    await h.notifications.dispatcher.flush();
    const [done] = h.notifications.journal.list({ state: 'sent', limit: 1 });
    expect(done).toMatchObject({ state: 'sent', attempts: 3 });
    expect(channel.sent).toHaveLength(1);
  });

  it('gives up on a refusal that cannot be repaired without retrying', async () => {
    const { h, connection } = await subscribed();
    h.channels.of(connection).failures = [permanent('unauthorized: the bot token is not valid')];
    await h.save(asking(QUESTIONS));
    const [failed] = h.notifications.journal.list({ state: 'failed' });
    expect(failed).toMatchObject({
      attempts: 1,
      error: 'unauthorized: the bot token is not valid',
    });
    h.clock.time += 3_600_000;
    await h.notifications.dispatcher.flush();
    expect(h.channels.of(connection).sent).toHaveLength(0);
  });

  it('waits as long as the channel asks and does not send twice', async () => {
    const { h, connection } = await subscribed();
    h.channels.of(connection).failures = [temporary('too many requests', 5000)];
    await h.save(asking(QUESTIONS));
    h.clock.time += 4999;
    await h.notifications.dispatcher.flush();
    expect(h.notifications.journal.list({ state: 'pending' })).toHaveLength(1);
    h.clock.time += 1;
    await h.notifications.dispatcher.flush();
    expect(h.notifications.journal.list({ state: 'pending' })).toEqual([]);
    expect(h.channels.of(connection).sent).toHaveLength(1);
  });

  it('gives up after the last pause of the schedule', async () => {
    const { h, connection } = await subscribed();
    h.channels.of(connection).failures = Array.from({ length: 10 }, () => temporary('down'));
    await h.save(asking(QUESTIONS));
    for (const pause of RETRY_MS) {
      h.clock.time += pause;
      await h.notifications.dispatcher.flush();
    }
    expect(h.notifications.journal.list({ state: 'failed' })).toMatchObject([
      { attempts: RETRY_MS.length + 1, error: 'down' },
    ]);
  });

  it('keeps a waiting delivery over a restart and sends it when its time comes', async () => {
    const { h, connection } = await subscribed();
    h.channels.of(connection).failures = [temporary('down')];
    await h.save(asking(QUESTIONS));
    expect(h.channels.of(connection).sent).toHaveLength(0);
    const again = h.restart();
    await again.dispatcher.start();
    // Before its time the retry does not run.
    expect(h.channels.of(connection).sent).toHaveLength(0);
    h.clock.time += RETRY_MS[0]!;
    await again.dispatcher.start();
    expect(h.channels.of(connection).sent).toHaveLength(1);
    expect(again.journal.list({ state: 'sent' })).toHaveLength(1);
  });

  it('fails a delivery of a subscription whose connection lost its chat', async () => {
    const { h, connection } = await subscribed();
    await h.base.services.connections.edit(connection, { set: {}, unset: ['chat_id'] });
    await h.save(asking(QUESTIONS));
    expect(h.notifications.journal.list({ state: 'failed' })).toMatchObject([
      { error: 'chat_id is not set' },
    ]);
    expect(h.channels.sentTotal()).toBe(0);
  });

  it('shows no token in the journal for an unknown error', async () => {
    const { h, connection } = await subscribed();
    h.channels.of(connection).failures = [
      new Error('https://api.telegram.org/bot123:SECRET/sendMessage'),
    ];
    await h.save(asking(QUESTIONS));
    const [pending] = h.notifications.journal.list({ state: 'pending' });
    expect(pending?.error).toBe('unexpected channel error');
    expect(JSON.stringify(h.notifications.journal.list({}))).not.toContain('SECRET');
  });
});

describe('closing the message', () => {
  it('closes it when the owner answers in the panel', async () => {
    const { h, connection } = await subscribed();
    const state = asking(QUESTIONS);
    await h.save(state);
    h.clock.time += 100;
    await h.notifications.dispatcher.idle();
    // The panel answers through the same event.
    const asked = state.groups[0]!;
    asked.decisions.push({
      stepId: 'plan',
      question: asked.question ?? '',
      answer: 'x',
      by: 'human',
    });
    asked.status = 'queued';
    asked.question = null;
    asked.questions = null;
    await h.save(state);
    const channel = h.channels.of(connection);
    const last = channel.updates.at(-1);
    expect(last?.message.state).toBe('closed');
    expect(last?.message.rows).toEqual([]);
    expect(last?.message.status).toBe('Closed: answered by a person outside the bot');
    expect(h.notifications.journal.list({ state: 'closed' })).toHaveLength(1);
  });

  it('says who closed it: autopilot, observer and a cancel', async () => {
    for (const [by, text] of [
      ['autopilot', 'the autopilot'],
      ['observer', 'an observer'],
    ] as const) {
      const { h, connection } = await subscribed();
      const state = asking(QUESTIONS);
      await h.save(state);
      const asked = state.groups[0]!;
      asked.decisions.push({ stepId: 'plan', question: '', answer: 'x', by });
      asked.status = 'queued';
      asked.question = null;
      asked.questions = null;
      await h.save(state);
      expect(h.channels.of(connection).updates.at(-1)?.message.status).toContain(text);
      await h.close();
    }
    const { h, connection } = await subscribed();
    const state = asking(QUESTIONS);
    await h.save(state);
    group(state).status = 'cancelled';
    await h.save(state);
    expect(h.channels.of(connection).updates.at(-1)?.message.status).toBe(
      'Closed: the group was cancelled',
    );
  });

  it('closes a question that waited for its turn without ever sending it', async () => {
    const { h, connection } = await subscribed();
    const channel = h.channels.of(connection);
    channel.failures = [temporary('down')];
    const state = asking(QUESTIONS);
    await h.save(state);
    group(state).status = 'cancelled';
    await h.save(state);
    expect(h.notifications.journal.list({ state: 'closed' })).toHaveLength(1);
    h.clock.time += RETRY_MS[0]!;
    await h.notifications.dispatcher.flush();
    expect(channel.sent).toHaveLength(0);
  });

  it('keeps the message of a failure as it is when the run goes on', async () => {
    const { h, connection } = await subscribed(['failed']);
    const state = asking(null);
    state.groups[0]!.status = 'failed';
    await h.save(state);
    state.groups[0]!.status = 'queued';
    await h.save(state);
    expect(h.channels.of(connection).updates).toEqual([]);
  });
});

describe('a slow channel', () => {
  it('does not hold the calls that save a run', async () => {
    const { h, connection } = await subscribed();
    const channel = h.channels.of(connection);
    let release = (): void => undefined;
    channel.gate = new Promise<void>((resolve) => (release = resolve));
    const state = asking(QUESTIONS);
    h.states.set(state.run.id, state);
    const started = Date.now();
    h.notifications.dispatcher.runChanged(state);
    // The call returned at once; so does anything else that goes on meanwhile.
    expect(Date.now() - started).toBeLessThan(50);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(channel.sent).toHaveLength(0);
    release();
    await h.notifications.dispatcher.idle();
    expect(channel.sent).toHaveLength(1);
  });
});

describe('the test message and the journal', () => {
  it('sends a test message and writes it to the journal', async () => {
    const { h, connection, subscription } = await subscribed();
    const view = await h.notifications.dispatcher.test(subscription.id);
    expect(view).toMatchObject({ kind: 'test', state: 'sent', attempts: 1 });
    expect(h.channels.of(connection).texts).toEqual(['Test message from aip: the channel works.']);
    expect(h.notifications.journal.list({ subscription: subscription.id })).toHaveLength(1);
  });

  it('reports a safe error of the channel and records the failure', async () => {
    const { h, connection, subscription } = await subscribed();
    await h.notifications.dispatcher.test(subscription.id);
    h.channels.of(connection).failures = [permanent('unauthorized: the bot token is not valid')];
    await expect(h.notifications.dispatcher.test(subscription.id)).rejects.toThrow(
      /unauthorized: the bot token is not valid/,
    );
    expect(h.notifications.journal.list({ state: 'failed' })).toMatchObject([
      { kind: 'test', error: 'unauthorized: the bot token is not valid' },
    ]);
  });

  it('clears what is older than the retention at the start, keeping an open question', async () => {
    const { h } = await subscribed(['question', 'failed']);
    const failed = asking(null);
    failed.groups[0]!.status = 'failed';
    failed.run.finishedAt = h.clock.time;
    await h.save(failed);
    await h.save(asking(QUESTIONS, { id: 'run000000002' }));
    h.clock.time += 31 * 86_400_000;
    await h.restart().dispatcher.start();
    const rest = h.notifications.journal.list({});
    expect(rest.map((one) => one.kind)).toEqual(['question']);
  });
});

describe('a channel that only sends', () => {
  const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

  async function webhook(h: Harness, url: string): Promise<string> {
    const view = await h.notifications.webhooks.add({ name: 'ci', url, allProjects: true });
    await h.base.services.connections.setSecret(view.id, 'signing_secret', SECRET);
    await h.base.services.connections.enable(view.id);
    return view.id;
  }

  it('is told of the end of a question by a delivery of its own', async () => {
    const hook = await startReceiver();
    try {
      const h = harness();
      current = h;
      const id = await webhook(h, `${hook.base}/hook`);
      const state = asking(QUESTIONS);
      await h.save(state);
      const asked = state.groups[0]!;
      asked.decisions.push({ stepId: 'plan', question: '', answer: 'x', by: 'human' });
      asked.status = 'queued';
      asked.question = null;
      asked.questions = null;
      await h.save(state);
      expect(hook.received.map((one) => JSON.parse(one.body).type)).toEqual([
        'question.asked',
        'question.closed',
      ]);
      const first = JSON.parse(hook.received[0]!.body);
      const second = JSON.parse(hook.received[1]!.body);
      expect(second.data.closed.by).toBe('human');
      expect(hook.received[1]!.headers['webhook-id']).not.toBe(
        hook.received[0]!.headers['webhook-id'],
      );
      expect(first.type).toBe('question.asked');
      expect(h.notifications.webhooks.log(id, {})).toHaveLength(2);
    } finally {
      await hook.close();
    }
  });

  it('does not hold the chats while a slow receiver thinks', async () => {
    const hook = await startReceiver();
    hook.answers.push({ status: 200, delayMs: 300 });
    try {
      const { h, connection } = await subscribed();
      await webhook(h, `${hook.base}/hook`);
      const started = Date.now();
      h.states.set('run000000001', asking(QUESTIONS));
      h.notifications.dispatcher.runChanged(h.states.get('run000000001')!);
      await until(() => h.channels.of(connection).sent.length === 1);
      // the chat got its message while the receiver was still thinking
      expect(Date.now() - started).toBeLessThan(200);
      await h.notifications.dispatcher.idle();
      expect(hook.received).toHaveLength(1);
    } finally {
      await hook.close();
    }
  });

  it('has at most four requests of a connection in flight', async () => {
    const hook = await startReceiver();
    for (let i = 0; i < 6; i += 1) hook.answers.push({ status: 200, delayMs: 150 });
    try {
      const h = harness();
      current = h;
      await webhook(h, `${hook.base}/hook`);
      for (let i = 1; i <= 6; i += 1) {
        const state = asking(QUESTIONS, { id: `run00000000${i}` });
        h.states.set(state.run.id, state);
        h.notifications.dispatcher.runChanged(state);
      }
      await until(() => hook.received.length >= 4);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(hook.received).toHaveLength(4);
      await h.notifications.dispatcher.idle();
      expect(hook.received).toHaveLength(6);
    } finally {
      await hook.close();
    }
  });
});

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(condition()).toBe(true);
}
