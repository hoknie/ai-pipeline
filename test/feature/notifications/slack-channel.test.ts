import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slackChannelFactory } from '../../../src/feature/notifications/clients/slack/channel.ts';
import {
  actionOf,
  parseEnvelope,
} from '../../../src/feature/notifications/clients/slack/events.ts';
import type {
  ChatChannelPort,
  InboundHandler,
} from '../../../src/feature/notifications/ports/index.ts';
import type {
  ChannelStatus,
  InboundInput,
  InboundResult,
} from '../../../src/feature/notifications/types/index.ts';
import { startFakeSlack, type FakeSlack } from '../../fakes/slack-api.ts';

const CHANNEL = 'C0123456789';
const USER = 'U01AAAAAAA';
const STRANGER = 'U09ZZZZZZZ';
const KEY = 'ABCDEFGHIJ';
const TIMING = { pingMs: 40, pongMs: 40, backoffMs: 10, maxBackoffMs: 40, connectMs: 1000 };

let slack: FakeSlack;
let aborts: AbortController[];

beforeEach(async () => {
  slack = await startFakeSlack();
  aborts = [];
});

afterEach(async () => {
  for (const one of aborts) one.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await slack.close();
});

function channel(
  params: Record<string, string> = {},
  secrets: { bot?: string | null; app?: string | null } = {},
): ChatChannelPort {
  const factory = slackChannelFactory({ base: slack.base, proxy: () => null, timing: TIMING });
  const tokens: Record<string, string | null> = {
    bot_token: secrets.bot === undefined ? slack.botToken : secrets.bot,
    app_token: secrets.app === undefined ? slack.appToken : secrets.app,
  };
  return factory.create({
    connection: {
      id: 'c1',
      name: 'team',
      kind: 'slack',
      params: { channel_id: CHANNEL, allowed_users: USER, ...params },
    },
    secret: (slot) => Promise.resolve(tokens[slot] ?? null),
    cursor: { get: () => null, set: () => undefined },
  });
}

/** Starts the listening; the object tells what the handler saw, what was reported and how it ended. */
function listen(
  target: ChatChannelPort,
  handle: (input: InboundInput) => InboundResult | Promise<InboundResult> = () => ({
    kind: 'ignored',
  }),
) {
  const controller = new AbortController();
  aborts.push(controller);
  const seen: InboundInput[] = [];
  const statuses: ChannelStatus[] = [];
  const handler: InboundHandler = {
    handle: async (input) => {
      seen.push(input);
      return handle(input);
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

const listening = (statuses: ChannelStatus[]) => statuses.some((one) => one.state === 'listening');

describe('slack channel: Socket Mode', () => {
  it('connects with the app token, reports listening and asks for the address with the app token only', async () => {
    const { statuses } = listen(channel());
    await until(() => listening(statuses), 'listening');
    const open = slack.callsOf('apps.connections.open');
    expect(open).toHaveLength(1);
    expect(open[0]!.token).toBe(slack.appToken);
    expect(slack.open()).toBe(1);
  });

  it('acknowledges an envelope before the handler is done with it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { seen, statuses } = listen(channel(), async () => {
      await gate;
      return { kind: 'selected' };
    });
    await until(() => listening(statuses), 'listening');
    const id = slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:o:1:2`,
    });
    await until(() => seen.length === 1, 'handler started');
    await until(() => slack.acks().includes(id), 'acknowledged');
    release();
  });

  it('opens a new connection after disconnect and handles the presses that follow', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'selected' }));
    await until(() => listening(statuses), 'listening');
    slack.disconnect('refresh_requested');
    await until(() => slack.callsOf('apps.connections.open').length === 2, 'asked again');
    await until(() => slack.peers.length === 2, 'second connection');
    await until(() => slack.peers[1]!.received !== undefined && statuses.length >= 1, 'ready');
    // the old connection is closed by the client, the new one carries the press
    await until(() => slack.peers[0]!.closed, 'the old one closed');
    await new Promise((resolve) => setTimeout(resolve, 30));
    slack.press({ channel: CHANNEL, user: USER, message: '1.1', actionId: `${KEY}:o:1:1` });
    await until(() => seen.length === 1, 'press handled');
  });

  it('reconnects after a dropped connection, with a pause', async () => {
    const { statuses } = listen(channel());
    await until(() => listening(statuses), 'listening');
    slack.drop();
    await until(() => slack.peers.length === 2, 'second connection');
    await until(() => statuses.filter((one) => one.state === 'listening').length === 2, 'again');
    expect(statuses.some((one) => one.state === 'error' && !one.unauthorized)).toBe(true);
  });

  it('reconnects when the server does not answer a ping', async () => {
    const { statuses } = listen(channel());
    await until(() => listening(statuses), 'listening');
    slack.peers[0]!.silent = true;
    await until(() => slack.peers.length === 2, 'second connection');
  });

  it('stops with an authorization error and does not ask again', async () => {
    const { statuses, done } = listen(channel({}, { app: 'xapp-wrong' }));
    await done;
    expect(statuses).toEqual([
      { state: 'error', error: expect.stringContaining('unauthorized'), unauthorized: true },
    ]);
    expect(JSON.stringify(statuses)).not.toContain('xapp-wrong');
    expect(slack.callsOf('apps.connections.open')).toHaveLength(1);
    expect(slack.peers).toHaveLength(0);
  });

  it('stops on a missing app token without a call', async () => {
    const { statuses, done } = listen(channel({}, { app: null }));
    await done;
    expect(statuses[0]).toMatchObject({ state: 'error', unauthorized: true });
    expect(slack.calls).toHaveLength(0);
  });

  it('tries again after another failure of the address request', async () => {
    slack.failures.set('apps.connections.open', [{ status: 500, error: 'fatal_error' }]);
    const { statuses } = listen(channel());
    await until(() => listening(statuses), 'listening after the failure');
    expect(statuses[0]).toMatchObject({ state: 'error', unauthorized: false });
    expect(slack.callsOf('apps.connections.open')).toHaveLength(2);
  });

  it('closes the connection when the signal aborts', async () => {
    const { statuses, done, stop } = listen(channel());
    await until(() => listening(statuses), 'listening');
    stop();
    await done;
    await until(() => slack.open() === 0, 'closed');
    expect(slack.peers[0]!.closedBy).toBe(1000);
    const asked = slack.callsOf('apps.connections.open').length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(slack.callsOf('apps.connections.open')).toHaveLength(asked);
  });
});

describe('slack channel: presses', () => {
  it('gives the core the same input for a button and for a choice in a list', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'selected' }));
    await until(() => listening(statuses), 'listening');
    slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:o:2:6`,
      actionTs: '10.1',
    });
    slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:o:2`,
      selected: '6',
      actionTs: '10.2',
    });
    await until(() => seen.length === 2, 'both');
    const [button, list] = seen as Extract<InboundInput, { type: 'action' }>[];
    expect(button).toMatchObject({
      type: 'action',
      chat: CHANNEL,
      user: USER,
      shortKey: KEY,
      action: 'o:2:6',
    });
    expect({ ...list, event: '' }).toEqual({ ...button, event: '' });
  });

  it('names a press by the key and the time of the press, not by the envelope', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'selected' }));
    await until(() => listening(statuses), 'listening');
    slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:r`,
      actionTs: '1700.0001',
      envelopeId: 'first',
    });
    slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:r`,
      actionTs: '1700.0001',
      envelopeId: 'second',
    });
    await until(() => seen.length === 2, 'both');
    // the core claims this id once: a press that came again in a new envelope is the same press
    expect(seen.map((one) => one.event)).toEqual([`${KEY}:1700.0001`, `${KEY}:1700.0001`]);
  });

  it('handles an envelope delivered again once and acknowledges it every time', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'selected' }));
    await until(() => listening(statuses), 'listening');
    const press = {
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:o:1:1`,
      envelopeId: 'same-envelope',
    };
    slack.press(press);
    await until(() => seen.length === 1, 'first');
    slack.press(press);
    await until(() => slack.acks().length === 2, 'acknowledged again');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toHaveLength(1);
    expect(slack.acks()).toEqual(['same-envelope', 'same-envelope']);
  });

  it('acknowledges an envelope it does not use and ignores a foreign element', async () => {
    const { seen, statuses } = listen(channel());
    await until(() => listening(statuses), 'listening');
    const slash = slack.envelope('slash_commands', { command: '/x' });
    const foreign = slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: 'somebody-elses-button',
    });
    await until(() => slack.acks().includes(slash) && slack.acks().includes(foreign), 'acks');
    expect(seen).toHaveLength(0);
  });

  it('tells a stranger, and only the stranger, that they may not answer', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'forbidden' }));
    await until(() => listening(statuses), 'listening');
    slack.press({ channel: CHANNEL, user: STRANGER, message: '1.1', actionId: `${KEY}:o:1:1` });
    await until(() => slack.ephemerals.length === 1, 'ephemeral');
    expect(seen[0]).toMatchObject({ user: STRANGER });
    expect(slack.ephemerals[0]).toEqual({
      channel: CHANNEL,
      user: STRANGER,
      text: 'You are not allowed to answer',
    });
    expect(slack.callsOf('chat.postMessage')).toHaveLength(0);
  });

  it('tells the user that the question is closed', async () => {
    const { statuses } = listen(channel({ language: 'ru' }), () => ({ kind: 'closed' }));
    await until(() => listening(statuses), 'listening');
    slack.press({ channel: CHANNEL, user: USER, message: '1.1', actionId: `${KEY}:r` });
    await until(() => slack.ephemerals.length === 1, 'ephemeral');
    expect(slack.ephemerals[0]!.text).toBe('Вопрос уже закрыт');
  });

  it('says nothing for a press that was taken', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'selected' }));
    await until(() => listening(statuses), 'listening');
    slack.press({ channel: CHANNEL, user: USER, message: '1.1', actionId: `${KEY}:r` });
    await until(() => seen.length === 1, 'handled');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(slack.ephemerals).toHaveLength(0);
    expect(slack.callsOf('chat.postMessage')).toHaveLength(0);
  });

  it('asks for a text answer in the thread of the message', async () => {
    const { statuses } = listen(channel(), () => ({
      kind: 'prompt',
      shortKey: KEY,
      questions: 2,
    }));
    await until(() => listening(statuses), 'listening');
    slack.press({ channel: CHANNEL, user: USER, message: '1700.5', actionId: `${KEY}:c` });
    await until(() => slack.messages.length === 1, 'prompt');
    expect(slack.messages[0]).toMatchObject({ channel: CHANNEL, thread_ts: '1700.5' });
    expect(slack.messages[0]!.text).toContain('N: text');
  });

  it('refuses a workspace that is not the one of the connection', async () => {
    const { seen, statuses } = listen(channel({ team_id: 'T0000000001' }), () => ({
      kind: 'selected',
    }));
    await until(() => listening(statuses), 'listening');
    slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:r`,
      team: 'T0999999999',
    });
    await until(() => slack.ephemerals.length === 1, 'ephemeral');
    slack.reply({
      channel: CHANNEL,
      user: USER,
      thread: '1.1',
      text: 'yes',
      team: 'T0999999999',
    });
    slack.press({
      channel: CHANNEL,
      user: USER,
      message: '1.1',
      actionId: `${KEY}:r`,
      team: 'T0000000001',
    });
    await until(() => seen.length === 1, 'the right workspace handled');
    expect(seen).toHaveLength(1);
  });
});

describe('slack channel: replies in a thread', () => {
  it('takes the text of a reply in the thread of the question, with its lines', async () => {
    const { seen, statuses } = listen(channel(), () => ({ kind: 'sent' }));
    await until(() => listening(statuses), 'listening');
    const id = slack.reply({
      channel: CHANNEL,
      user: USER,
      thread: '1700.5',
      text: '1: да\n2: нет',
    });
    await until(() => seen.length === 1, 'reply');
    expect(seen[0]).toEqual({
      type: 'text',
      event: id,
      chat: CHANNEL,
      user: USER,
      text: '1: да\n2: нет',
      target: { shortKey: null, message: '1700.5' },
    });
    await until(() => slack.ephemerals.length === 1, 'the result');
    expect(slack.ephemerals[0]).toMatchObject({
      user: USER,
      text: 'Answer sent',
      thread_ts: '1700.5',
    });
  });

  it('does not react to a message outside a thread', async () => {
    const { seen, statuses } = listen(channel());
    await until(() => listening(statuses), 'listening');
    const id = slack.reply({ channel: CHANNEL, user: USER, text: '1: yes' });
    await until(() => slack.acks().includes(id), 'acknowledged');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toHaveLength(0);
    expect(slack.ephemerals).toHaveLength(0);
    expect(slack.messages).toHaveLength(0);
  });

  it('ignores bots, edits and deletions', async () => {
    const { seen, statuses } = listen(channel());
    await until(() => listening(statuses), 'listening');
    const base = { channel: CHANNEL, user: USER, thread: '1700.5', text: '1: yes' };
    const ids = [
      slack.reply({ ...base, extra: { bot_id: 'B01' } }),
      slack.reply({ ...base, extra: { subtype: 'message_changed' } }),
      slack.reply({ ...base, extra: { subtype: 'message_deleted' } }),
    ];
    await until(() => ids.every((id) => slack.acks().includes(id)), 'acknowledged');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toHaveLength(0);
  });

  it('stays silent for a stranger in a thread, and tells about a format error', async () => {
    const answers: InboundResult[] = [{ kind: 'forbidden' }, { kind: 'format' }];
    const { seen, statuses } = listen(channel(), () => answers.shift()!);
    await until(() => listening(statuses), 'listening');
    slack.reply({ channel: CHANNEL, user: STRANGER, thread: '1.1', text: 'hello' });
    slack.reply({ channel: CHANNEL, user: USER, thread: '1.1', text: 'oops' });
    await until(() => seen.length === 2, 'both');
    await until(() => slack.ephemerals.length === 1, 'the hint');
    expect(slack.ephemerals[0]).toMatchObject({ user: USER, text: 'Use the format N: text' });
  });
});

describe('slack channel: the factory', () => {
  it('knows who may act and what a subscription needs', () => {
    const factory = slackChannelFactory({ base: slack.base, proxy: () => null });
    const params = { channel_id: CHANNEL, allowed_users: `${USER},W01BBBBBBB` };
    expect(factory.kind).toBe('slack');
    expect(factory.allows(params, CHANNEL, 'W01BBBBBBB')).toBe(true);
    expect(factory.allows(params, 'C0999999999', USER)).toBe(false);
    expect(factory.allows(params, CHANNEL, STRANGER)).toBe(false);
    expect(factory.allows({ allowed_users: USER }, CHANNEL, USER)).toBe(false);
    expect(factory.missingForSubscription({ allowed_users: USER })).toBe('channel_id');
    expect(factory.missingForSubscription(params)).toBeNull();
    expect(factory.language({ language: 'ru' })).toBe('ru');
    expect(factory.language({})).toBe('en');
  });
});

describe('slack events', () => {
  it('reads the action of a button, of a list and refuses what is not ours', () => {
    expect(actionOf(`${KEY}:o:1:2`, null)).toEqual({ shortKey: KEY, action: 'o:1:2' });
    expect(actionOf(`${KEY}:o:3`, '7')).toEqual({ shortKey: KEY, action: 'o:3:7' });
    expect(actionOf(`${KEY}:o:3`, null)).toBeNull();
    expect(actionOf(`${KEY}:c`, null)).toEqual({ shortKey: KEY, action: 'c' });
    expect(actionOf(`${KEY}:x`, null)).toBeNull();
    expect(actionOf('plain', null)).toBeNull();
  });

  it('reads the envelopes and drops what is not JSON of the protocol', () => {
    expect(parseEnvelope('nonsense')).toBeNull();
    expect(parseEnvelope('[]')).toBeNull();
    expect(parseEnvelope('{"type":"hello"}')).toEqual({ type: 'hello' });
    expect(parseEnvelope('{"type":"disconnect","reason":"warning"}')).toEqual({
      type: 'disconnect',
      reason: 'warning',
    });
    expect(
      parseEnvelope('{"type":"interactive","envelope_id":"e","payload":{"type":"x"}}'),
    ).toEqual({
      type: 'other',
      envelopeId: 'e',
    });
    expect(parseEnvelope('{"type":"events_api","payload":{}}')).toEqual({
      type: 'other',
      envelopeId: null,
    });
  });
});
