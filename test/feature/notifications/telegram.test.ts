import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { telegramChannelFactory } from '../../../src/feature/notifications/clients/telegram/channel.ts';
import { allowedUsers } from '../../../src/feature/notifications/clients/telegram/kind.ts';
import {
  CALLBACK_LIMIT,
  TEXT_LIMIT,
} from '../../../src/feature/notifications/clients/telegram/render.ts';
import type {
  ChatChannelPort,
  InboundHandler,
} from '../../../src/feature/notifications/ports/index.ts';
import {
  ChannelFailure,
  chatMessage,
  type ChannelStatus,
  type Draw,
  type EventData,
  type InboundInput,
  type InboundResult,
} from '../../../src/feature/notifications/types/index.ts';
import { startFakeTelegram, type FakeTelegram } from '../../fakes/telegram-api.ts';

import { eventData } from './helpers.ts';

const CHAT = -1001;
const USER = 111;

let api: FakeTelegram;
let cursor: string | null;
let aborts: AbortController[];

beforeEach(async () => {
  api = await startFakeTelegram();
  cursor = null;
  aborts = [];
});

afterEach(async () => {
  for (const one of aborts) one.abort();
  await api.close();
});

function channel(
  params: Record<string, string> = {},
  options: { token?: string | null } = {},
): ChatChannelPort {
  const factory = telegramChannelFactory({ base: api.base, proxy: () => null });
  return factory.create({
    connection: {
      id: 'c1',
      name: 'main',
      kind: 'telegram',
      params: { chat_id: String(CHAT), allowed_users: String(USER), ...params },
    },
    secret: () => Promise.resolve(options.token === undefined ? api.token : options.token),
    cursor: {
      get: () => cursor,
      set: (value) => void (cursor = value),
    },
  });
}

const drawOf =
  (patch: Partial<EventData>, closure = null as null): Draw =>
  (limits) =>
    chatMessage({
      kind: 'question',
      run: 'r1',
      data: eventData({ humanOnly: null, ...patch }),
      drafts: (patch.questions ?? []).map(() => null),
      closure,
      channel: 'main',
      language: 'en',
      publicUrl: null,
      limits,
    });

const question = (text: string, options: string[] = [], recommendation: string | null = null) => ({
  text,
  options,
  recommendation,
});

/** Starts the listening; the returned object tells what the handler saw and how it ended. */
function listen(
  target: ChatChannelPort,
  handle: (input: InboundInput) => InboundResult = () => ({ kind: 'ignored' }),
) {
  const controller = new AbortController();
  aborts.push(controller);
  const seen: InboundInput[] = [];
  const statuses: ChannelStatus[] = [];
  const handler: InboundHandler = {
    handle: (input) => {
      seen.push(input);
      return Promise.resolve(handle(input));
    },
  };
  const done = target.listen(handler, controller.signal, (status) => statuses.push(status));
  return { seen, statuses, done, stop: () => controller.abort() };
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('telegram channel: messages', () => {
  it('escapes the text of tasks and questions', async () => {
    const ref = await channel().send(
      drawOf({ title: '<b>&', questions: [question('use <script> & more?', ['a<b'])] }),
      'ABCDEFGHIJ',
    );
    const [message] = api.messages;
    expect(ref).toEqual({ chat_id: String(CHAT), message_id: message!.message_id });
    expect(message!.parse_mode).toBe('HTML');
    expect(message!.text).toContain('use &lt;script&gt; &amp; more?');
    expect(message!.text).toContain('a&lt;b');
    expect(message!.text).not.toContain('<script>');
  });

  it('puts the options in an inline keyboard whose data names no text', async () => {
    const long = 'x'.repeat(200);
    await channel().send(
      drawOf({
        questions: [question('Which?', [long, 'short'], 'short'), question('And?', ['yes', 'no'])],
      }),
      'ABCDEFGHIJ',
    );
    const keyboard = api.messages[0]!.reply_markup!.inline_keyboard!;
    expect(keyboard).toHaveLength(3);
    expect(keyboard[0]![0]!.text.length).toBeLessThan(long.length);
    expect(keyboard[0]![0]!.text).toMatch(/^1\.1 x+/);
    // the whole text of the option is in the body, under its number
    expect(api.messages[0]!.text).toContain(`1.1 ${long}`);
    for (const row of keyboard) {
      for (const button of row) {
        expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(CALLBACK_LIMIT);
        expect(button.callback_data).toMatch(/^ABCDEFGHIJ:[a-z](:\d+){0,2}$/);
      }
    }
    expect(keyboard[0]![0]!.callback_data).toBe('ABCDEFGHIJ:o:1:1');
    expect(keyboard[2]!.map((button) => button.callback_data)).toEqual([
      'ABCDEFGHIJ:r',
      'ABCDEFGHIJ:c',
    ]);
  });

  it('keeps a message within 4096 characters and every option as a button', async () => {
    const huge = 'word '.repeat(2000);
    await channel().send(
      drawOf({
        question: huge,
        questions: [question(huge, ['one', 'two', 'three', huge])],
      }),
      'ABCDEFGHIJ',
    );
    const message = api.messages[0]!;
    expect(message.text.length).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(message.reply_markup!.inline_keyboard![0]).toHaveLength(4);
  });

  it('treats "message is not modified" as success and removes buttons on update', async () => {
    const target = channel();
    const draw = drawOf({ questions: [question('Which?', ['a', 'b'])] });
    const ref = await target.send(draw, 'ABCDEFGHIJ');
    await expect(target.update(ref, draw, 'ABCDEFGHIJ')).resolves.toBeUndefined();
    await target.update(
      ref,
      drawOf({ questions: [question('Which?', ['a', 'b'])] }, { by: 'human' } as never),
      'ABCDEFGHIJ',
    );
    const message = api.messages[0]!;
    expect(message.reply_markup!.inline_keyboard).toEqual([]);
    expect(message.text).toContain('answered by a person outside the bot');
  });

  it('sends a plain text to the chat', async () => {
    const ref = await channel().sendText('hello <b>');
    expect(api.messages[0]).toMatchObject({ chat_id: CHAT, text: 'hello <b>' });
    expect(api.messages[0]!.parse_mode).toBeUndefined();
    expect(ref.chat_id).toBe(String(CHAT));
  });
});

describe('telegram channel: refusals', () => {
  it('turns 429 into a pause the channel asked for', async () => {
    api.failures.set('sendMessage', [
      { status: 429, description: 'Too Many Requests: retry after 5', retryAfter: 5 },
    ]);
    const error = await channel()
      .send(drawOf({}), 'ABCDEFGHIJ')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChannelFailure);
    expect(error).toMatchObject({ permanent: false, retryAfterMs: 5000 });
  });

  it.each([400, 403])('gives up on %i with a safe description', async (status) => {
    api.failures.set('sendMessage', [
      { status, description: `refused with bot${api.token} inside` },
    ]);
    const error = (await channel()
      .send(drawOf({}), 'ABCDEFGHIJ')
      .catch((caught: unknown) => caught)) as ChannelFailure;
    expect(error.permanent).toBe(true);
    expect(error.message).not.toContain(api.token);
  });

  it('reports a wrong token as unauthorized and never shows it', async () => {
    const error = (await channel({}, { token: '999:wrong-token-abcdefghij' })
      .send(drawOf({}), 'ABCDEFGHIJ')
      .catch((caught: unknown) => caught)) as ChannelFailure;
    expect(error).toMatchObject({ permanent: true, unauthorized: true });
    expect(error.message).not.toContain('wrong-token');
  });

  it('refuses to send without chat_id and without a secret', async () => {
    const bare = telegramChannelFactory({ base: api.base, proxy: () => null }).create({
      connection: { id: 'c', name: 'n', kind: 'telegram', params: { allowed_users: '1' } },
      secret: () => Promise.resolve(api.token),
      cursor: { get: () => null, set: () => undefined },
    });
    await expect(bare.send(drawOf({}), 'ABCDEFGHIJ')).rejects.toMatchObject({ permanent: true });
    await expect(channel({}, { token: null }).send(drawOf({}), 'ABCDEFGHIJ')).rejects.toMatchObject(
      { unauthorized: true },
    );
    expect(api.calls).toHaveLength(0);
  });

  it('does not put the address in a network error', async () => {
    const dead = telegramChannelFactory({ base: 'http://127.0.0.1:1', proxy: () => null }).create({
      connection: { id: 'c', name: 'n', kind: 'telegram', params: { chat_id: '1' } },
      secret: () => Promise.resolve(api.token),
      cursor: { get: () => null, set: () => undefined },
    });
    const error = (await dead.sendText('x').catch((caught: unknown) => caught)) as ChannelFailure;
    expect(error.permanent).toBe(false);
    expect(error.message).not.toContain('127.0.0.1');
    expect(error.message).not.toContain(api.token);
  });
});

describe('telegram channel: updates', () => {
  it('asks only for messages and callbacks and keeps the position after a batch', async () => {
    const first = api.text({ chat: CHAT, user: USER, text: 'hi' });
    const { seen } = listen(channel());
    await until(() => cursor === String(first + 1), 'position saved');
    expect(api.callsOf('getUpdates')[0]!.body).toMatchObject({
      allowed_updates: ['message', 'callback_query'],
    });
    expect(seen).toHaveLength(0);
    await until(
      () => api.callsOf('getUpdates').some((call) => call.body.offset === first + 1),
      'offset',
    );
  });

  it('does not read again what the position already passed', async () => {
    const old = api.text({ chat: CHAT, user: USER, text: 'old', replyTo: { message_id: 1 } });
    cursor = String(old + 1);
    const { seen } = listen(channel());
    await until(() => api.callsOf('getUpdates').length > 0, 'polled');
    expect(api.callsOf('getUpdates')[0]!.body.offset).toBe(old + 1);
    expect(seen).toHaveLength(0);
  });

  it('answers a button and tells the user the result', async () => {
    const id = api.callback({
      chat: CHAT,
      user: USER,
      message: 7,
      data: 'ABCDEFGHIJ:o:1:2',
      id: 'q1',
    });
    const { seen } = listen(channel(), () => ({ kind: 'selected' }));
    await until(() => api.answered.length === 1, 'answered');
    expect(seen).toEqual([
      {
        type: 'action',
        event: String(id),
        chat: String(CHAT),
        user: String(USER),
        shortKey: 'ABCDEFGHIJ',
        action: 'o:1:2',
      },
    ]);
    expect(api.answered[0]).toEqual({ id: 'q1', text: 'Selected' });
  });

  it('passes the chat of the button as it is: a press from another chat is for the core to refuse', async () => {
    api.callback({ chat: -555, user: 222, message: 7, data: 'ABCDEFGHIJ:r', id: 'q2' });
    const { seen } = listen(channel(), () => ({ kind: 'forbidden' }));
    await until(() => api.answered.length === 1, 'answered');
    expect(seen[0]).toMatchObject({ chat: '-555', user: '222' });
    expect(api.answered[0]!.text).toBe('You are not allowed to answer');
    const factory = telegramChannelFactory({ base: api.base, proxy: () => null });
    const params = { chat_id: String(CHAT), allowed_users: '111,333' };
    expect(factory.allows(params, String(CHAT), '333')).toBe(true);
    expect(factory.allows(params, '-555', '111')).toBe(false);
    expect(factory.allows(params, String(CHAT), '222')).toBe(false);
    expect(factory.allows({ allowed_users: '111' }, String(CHAT), '111')).toBe(false);
  });

  it('asks for a reply with force_reply and takes the text from the reply to the prompt', async () => {
    api.callback({ chat: CHAT, user: USER, message: 7, data: 'ABCDEFGHIJ:c', id: 'q3' });
    const target = listen(channel(), (input) =>
      input.type === 'action'
        ? { kind: 'prompt', shortKey: 'ABCDEFGHIJ', questions: 2 }
        : { kind: 'sent' },
    );
    await until(() => api.messages.length === 1, 'prompt');
    const prompt = api.messages[0]!;
    expect(prompt.reply_markup).toMatchObject({ force_reply: true });
    expect(prompt.text).toContain('#ABCDEFGHIJ');
    expect(prompt.text).toContain('N: text');
    api.text({
      chat: CHAT,
      user: USER,
      text: '1: yes',
      replyTo: { message_id: prompt.message_id, text: prompt.text },
    });
    await until(() => target.seen.length === 2, 'text');
    expect(target.seen[1]).toMatchObject({
      type: 'text',
      chat: String(CHAT),
      user: String(USER),
      text: '1: yes',
      target: { shortKey: 'ABCDEFGHIJ', message: String(prompt.message_id) },
    });
    await until(() => api.messages.length === 2, 'reply');
    expect(api.messages[1]!.text).toBe('Answer sent');
  });

  it('names the message a reply is written to when it carries no key', async () => {
    api.text({
      chat: CHAT,
      user: USER,
      text: '2: no',
      replyTo: { message_id: 42, text: 'Question' },
    });
    const { seen } = listen(channel(), () => ({ kind: 'format' }));
    await until(() => seen.length === 1, 'text');
    expect(seen[0]).toMatchObject({ target: { shortKey: null, message: '42' } });
    await until(() => api.messages.length === 1, 'hint');
    expect(api.messages[0]!.text).toBe('Use the format N: text');
  });

  it('ignores a text that answers nothing and commands other than /id', async () => {
    api.text({ chat: CHAT, user: USER, text: 'just talking' });
    api.text({ chat: CHAT, user: USER, text: '/start' });
    const { seen } = listen(channel());
    await until(() => cursor !== null, 'position saved');
    expect(seen).toHaveLength(0);
    expect(api.messages).toHaveLength(0);
  });

  it('answers /id in any chat with the ids of the chat and of the user, even to a stranger', async () => {
    api.text({ chat: -777, user: 999, text: '/id' });
    api.text({ chat: 5, user: 6, text: '/id@some_bot' });
    const { seen } = listen(channel({ language: 'ru' }));
    await until(() => api.messages.length === 2, 'replies');
    expect(api.messages[0]).toMatchObject({
      chat_id: -777,
      text: 'Id чата: -777\nВаш id пользователя: 999',
    });
    expect(api.messages[1]!.chat_id).toBe(5);
    expect(seen).toHaveLength(0);
  });

  it('skips an update it cannot read but still moves past it', async () => {
    const bad = api.push({ message: { message_id: 'not a number' } });
    listen(channel());
    await until(() => cursor === String(bad + 1), 'position saved');
  });

  it('survives a handler that throws', async () => {
    api.callback({ chat: CHAT, user: USER, message: 7, data: 'ABCDEFGHIJ:r' });
    const second = api.callback({ chat: CHAT, user: USER, message: 7, data: 'ABCDEFGHIJ:r' });
    const { seen } = listen(channel(), (input) => {
      if (seen.length === 1) throw new Error('boom');
      return { kind: 'selected' };
    });
    await until(() => cursor === String(second + 1), 'position saved');
    expect(seen).toHaveLength(2);
  });

  it('stops asking Telegram when the signal aborts', async () => {
    const { done, stop } = listen(channel());
    await until(() => api.callsOf('getUpdates').length > 0, 'polled');
    stop();
    await done;
    const count = api.callsOf('getUpdates').length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.callsOf('getUpdates').length).toBe(count);
  });
});

describe('telegram channel: polling errors', () => {
  it('stops on 401 and says the credentials are rejected', async () => {
    const { statuses, done } = listen(channel({}, { token: '999:wrong-token-abcdefghij' }));
    await done;
    expect(statuses).toEqual([
      { state: 'error', error: expect.stringContaining('unauthorized'), unauthorized: true },
    ]);
    expect(api.callsOf('getUpdates')).toHaveLength(1);
  });

  it('shows 409 as a connection error with a hint and waits', async () => {
    api.failures.set('getUpdates', [
      { status: 409, description: "Conflict: can't use getUpdates while a webhook is active" },
    ]);
    const { statuses } = listen(channel());
    await until(() => statuses.length === 1, 'status');
    expect(statuses[0]).toMatchObject({ state: 'error', unauthorized: false });
    expect((statuses[0] as { error: string }).error).toContain('webhook');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.callsOf('getUpdates')).toHaveLength(1);
  });
});

describe('telegram kind', () => {
  it('reads the allowed users', () => {
    expect(allowedUsers({ allowed_users: '1, 2,3' })).toEqual(['1', '2', '3']);
    expect(allowedUsers({})).toEqual([]);
  });

  it('knows what a subscription needs', () => {
    const factory = telegramChannelFactory({ base: api.base, proxy: () => null });
    expect(factory.missingForSubscription({ allowed_users: '1' })).toBe('chat_id');
    expect(factory.missingForSubscription({ chat_id: '5', allowed_users: '1' })).toBeNull();
    expect(factory.language({ language: 'ru' })).toBe('ru');
    expect(factory.language({})).toBe('en');
  });
});
