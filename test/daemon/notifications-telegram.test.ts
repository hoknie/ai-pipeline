import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionView } from '../../src/presentation/ipc/contract/index.ts';
import { startFakeTelegram, type FakeTelegram } from '../fakes/telegram-api.ts';
import { MemoryStore } from '../feature/integrations/helpers.ts';

import { calls, run } from './control-harness.ts';
import { harness, settle, until, type Harness } from './harness.ts';

const CHAT = -1001;
const USER = 111;

let api: FakeTelegram | null = null;
let daemon: Harness | null = null;

afterEach(async () => {
  await daemon?.close();
  await api?.close();
  daemon = null;
  api = null;
});

async function start() {
  api = await startFakeTelegram();
  daemon = await harness(
    undefined,
    { AIP_TELEGRAM_API: api.base },
    { integrations: { secretStore: new MemoryStore() } },
  );
  await daemon.call('repository_add', { path: daemon.repo });
  return { h: daemon, fake: api };
}

async function connect(h: Harness, fake: FakeTelegram, params: Record<string, string> = {}) {
  const added = (await h.call('integration_add', {
    kind: 'telegram',
    name: 'main',
    global: true,
    params: { chat_id: String(CHAT), allowed_users: String(USER), ...params },
  })) as ConnectionView;
  await h.call('integration_secret_set', { id: added.id, slot: 'bot_token', value: fake.token });
  await h.call('integration_enable', { id: added.id });
  return added.id;
}

const QUESTIONS = [
  { text: 'OAuth or password?', options: ['OAuth', 'password'], recommendation: 'OAuth' },
];

function ask(h: Harness, questions = QUESTIONS) {
  h.script({ code: [{ verdict: 'needs_human', questions }, {}] });
  return run(h);
}

describe('telegram notifications of a daemon', () => {
  it('makes no request without an enabled connection, then only polls and answers /id', async () => {
    const { h, fake } = await start();
    const runId = await ask(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    await settle(h);
    expect(fake.calls).toEqual([]);

    const connection = await connect(h, fake);
    await until('polling', () => fake.callsOf('getUpdates').length > 0);
    // a connection without subscriptions tells nothing about the open question
    fake.text({ chat: 5, user: 6, text: '/id' });
    await until('the answer to /id', () => fake.callsOf('sendMessage').length === 1);
    expect(fake.messages[0]).toMatchObject({ chat_id: 5, text: 'Chat id: 5\nYour user id: 6' });
    await settle(h);
    expect(fake.callsOf('sendMessage')).toHaveLength(1);

    await h.call('integration_disable', { id: connection });
    await settle(h);
    const polled = fake.callsOf('getUpdates').length;
    await settle(h);
    expect(fake.callsOf('getUpdates').length).toBe(polled);
  });

  it('sends the question, takes the button and goes on with the answer in the panel format', async () => {
    const { h, fake } = await start();
    const connection = await connect(h, fake);
    await h.call('notify_add', { connection, allProjects: true });
    const runId = await ask(h);

    await until('the message', () => fake.messages.length === 1);
    const message = fake.messages[0]!;
    expect(message.chat_id).toBe(CHAT);
    expect(message.text).toContain('OAuth or password?');
    const buttons = message.reply_markup!.inline_keyboard!.flat();
    const choice = buttons.find((button) => button.text.includes('password'))!;
    expect(Buffer.byteLength(choice.callback_data)).toBeLessThanOrEqual(64);

    fake.callback({
      chat: CHAT,
      user: USER,
      message: message.message_id,
      data: choice.callback_data,
      id: 'press',
    });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups.map((group) => group.status)).toEqual(['merged']);
    expect(
      calls(h)
        .filter((call) => call.step === 'code')[1]
        ?.args.join(' '),
    ).toContain('A1: password');
    expect(fake.answered.find((one) => one.id === 'press')?.text).toBe('Answer sent');
    await until(
      'the message closed',
      () => fake.messages[0]!.reply_markup?.inline_keyboard?.length === 0,
    );
    expect(fake.messages[0]!.text).toContain('Answer sent via main by user 111');
  });

  it('refuses a user outside the list and does not touch the group', async () => {
    const { h, fake } = await start();
    const connection = await connect(h, fake);
    await h.call('notify_add', { connection, allProjects: true });
    const runId = await ask(h);
    await until('the message', () => fake.messages.length === 1);
    const data = fake.messages[0]!.reply_markup!.inline_keyboard![0]![0]!.callback_data;
    fake.callback({ chat: CHAT, user: 999, message: 1, data, id: 'stranger' });
    fake.callback({ chat: -555, user: USER, message: 1, data, id: 'elsewhere' });
    await until('both answered', () => fake.answered.length === 2);
    expect(fake.answered.map((one) => one.text)).toEqual([
      'You are not allowed to answer',
      'You are not allowed to answer',
    ]);
    expect((await h.status(runId)).groups[0]?.status).toBe('needs_human');
  });

  it('restarts the polling after chat_id is edited: the old chat closes its message, the new one gets the next events', async () => {
    const { h, fake } = await start();
    const connection = await connect(h, fake);
    await h.call('notify_add', { connection, allProjects: true });
    const ask = { verdict: 'needs_human', questions: QUESTIONS };
    h.script({ code: [ask, {}, ask, {}] });
    const first = await run(h);
    await until('the first message', () => fake.messages.length === 1);
    await until('polling', () => fake.callsOf('getUpdates').length > 0);

    const edited = (await h.call('integration_edit', {
      id: connection,
      set: { chat_id: '-2002' },
    })) as ConnectionView;
    expect(edited.enabled).toBe(true);
    const before = fake.callsOf('getUpdates').length;
    await until('polling again', () => fake.callsOf('getUpdates').length > before);

    // answered in the panel: the message is closed in the chat it was sent to
    await h.call('answer', { runId: first, group: 'g1', answer: 'Q1: OAuth\nA1: OAuth' });
    await until(
      'closed in the old chat',
      () => fake.messages[0]!.reply_markup?.inline_keyboard?.length === 0,
    );
    expect(fake.callsOf('editMessageText').at(-1)?.body.chat_id).toBe(CHAT);
    await h.waitFor(first, (view) => view.finished);

    await run(h);
    await until('the second message', () => fake.messages.length === 2);
    expect(fake.messages[1]!.chat_id).toBe(-2002);
  });
});
