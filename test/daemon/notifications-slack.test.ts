import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView } from '../../src/presentation/ipc/contract/index.ts';
import { startFakeSlack, type FakeSlack, type FakeSlackMessage } from '../fakes/slack-api.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';

import { calls, run } from './control-harness.ts';
import { harness, until, type Harness } from './harness.ts';

const CHANNEL = 'C0123456789';
const USER = 'U01AAAAAAA';

let api: FakeSlack | null = null;
let daemon: Harness | null = null;

afterEach(async () => {
  await daemon?.close();
  await api?.close();
  daemon = null;
  api = null;
});

async function start() {
  api = await startFakeSlack();
  daemon = await harness(
    undefined,
    { AIP_SLACK_API: api.base },
    { integrations: { secretStore: new MemoryStore() } },
  );
  await daemon.call('repository_add', { path: daemon.repo });
  return { h: daemon, fake: api };
}

async function connect(h: Harness, fake: FakeSlack) {
  const added = (await h.call('integration_add', {
    kind: 'slack',
    name: 'main',
    global: true,
    params: { channel_id: CHANNEL, allowed_users: USER },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'bot_token', value: fake.botToken });
  await h.call('integration_secret_set', { id: added.id, slot: 'app_token', value: fake.appToken });
  await h.call('integration_enable', { id: added.id });
  await until('the socket', () => fake.open() === 1);
  await h.call('notify_add', { connection: added.id, allProjects: true });
  return added.id;
}

const QUESTIONS = [
  { text: 'OAuth or password?', options: ['OAuth', 'password'], recommendation: 'OAuth' },
];

function ask(h: Harness) {
  h.script({ code: [{ verdict: 'needs_human', questions: QUESTIONS }, {}] });
  return run(h);
}

const elements = (message: FakeSlackMessage) =>
  message.blocks.flatMap((block) =>
    block.type === 'actions' ? (block.elements as Record<string, any>[]) : [],
  );

describe('slack notifications of a daemon', () => {
  it('sends the question to the channel, takes the button and goes on with the answer', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const runId = await ask(h);

    await until('the message', () => fake.messages.length === 1);
    const message = fake.messages[0]!;
    expect(message.channel).toBe(CHANNEL);
    expect(JSON.stringify(message.blocks)).toContain('OAuth or password?');
    expect(fake.callsOf('chat.postMessage')[0]!.token).toBe(fake.botToken);
    const choice = elements(message).find((one) => one.text?.text.includes('password'))!;

    fake.press({
      channel: CHANNEL,
      user: USER,
      message: message.ts,
      actionId: choice.action_id,
      actionTs: '1700000500.000200',
    });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups.map((group) => group.status)).toEqual(['merged']);
    expect(
      calls(h)
        .filter((call) => call.step === 'code')[1]
        ?.args.join(' '),
    ).toContain('A1: password');
    await until('the message closed', () => elements(fake.messages[0]!).length === 0);
    expect(JSON.stringify(fake.messages[0]!.blocks)).toContain(
      `Answer sent via main by user ${USER}`,
    );
    expect(fake.callsOf('chat.update').length).toBeGreaterThan(0);
  });

  it('refuses a user outside the list with a message only they see', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const runId = await ask(h);
    await until('the message', () => fake.messages.length === 1);
    const message = fake.messages[0]!;
    const data = elements(message)[0]!.action_id as string;
    fake.press({ channel: CHANNEL, user: 'U09ZZZZZZZ', message: message.ts, actionId: data });
    await until('the refusal', () => fake.ephemerals.length === 1);
    expect(fake.ephemerals[0]).toMatchObject({
      channel: CHANNEL,
      user: 'U09ZZZZZZZ',
      text: 'You are not allowed to answer',
    });
    expect((await h.status(runId)).groups[0]?.status).toBe('needs_human');
  });

  it('takes a text answer from the thread of the message', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const runId = await ask(h);
    await until('the message', () => fake.messages.length === 1);
    const message = fake.messages[0]!;

    fake.reply({ channel: CHANNEL, user: USER, text: 'the usual one' });
    fake.reply({ channel: CHANNEL, user: USER, thread: message.ts, text: '1: password' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups.map((group) => group.status)).toEqual(['merged']);
    expect(
      calls(h)
        .filter((call) => call.step === 'code')[1]
        ?.args.join(' '),
    ).toContain('A1: password');
  });

  it('updates the Slack message when the question is answered in the panel', async () => {
    const { h, fake } = await start();
    await connect(h, fake);
    const runId = await ask(h);
    await until('the message', () => fake.messages.length === 1);
    expect(elements(fake.messages[0]!).length).toBeGreaterThan(0);
    const before = fake.callsOf('chat.update').length;

    await h.call('answer', { runId, group: 'g1', answer: 'Q1: OAuth\nA1: OAuth' });
    await until('the message closed', () => elements(fake.messages[0]!).length === 0);
    expect(fake.callsOf('chat.update').length).toBeGreaterThan(before);
    expect(fake.callsOf('chat.update').at(-1)?.body.ts).toBe(fake.messages[0]!.ts);
    expect(JSON.stringify(fake.messages[0]!.blocks)).toContain('answered by a person outside');
    await h.waitFor(runId, (view) => view.finished);
  });

  it('closes the Socket Mode connection when the connection is disabled', async () => {
    const { h, fake } = await start();
    const id = await connect(h, fake);
    await h.call('integration_disable', { id });
    await until('the socket closed', () => fake.open() === 0);
  });
});
