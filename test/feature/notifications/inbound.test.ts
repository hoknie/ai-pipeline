import { afterEach, describe, expect, it } from 'vitest';

import { rejected } from '../../../src/platform/errors/index.ts';
import type { InboundInput } from '../../../src/feature/notifications/types/index.ts';
import { transition } from '../../../src/feature/runs/machine/index.ts';

import { asking, chatConnection, harness, type Harness } from './helpers.ts';

let current: Harness | null = null;
afterEach(async () => {
  await current?.close();
  current = null;
});

const ONE = [
  { text: 'Which database?', options: ['SQLite', 'PostgreSQL'], recommendation: 'PostgreSQL' },
];
const THREE = [
  { text: 'Which database?', options: ['SQLite', 'PostgreSQL'], recommendation: 'PostgreSQL' },
  { text: 'Add tests?', options: ['yes', 'no'], recommendation: 'yes' },
  { text: 'Name?' },
];
const PARAMS = { chat_id: '-100', allowed_users: '111,222' };

let counter = 0;

async function setup(
  questions: Parameters<typeof asking>[0],
  options: Parameters<typeof asking>[1] = {},
) {
  const h = harness();
  current = h;
  const connection = await chatConnection(h.base, { params: PARAMS });
  await h.notifications.subscriptions.add({ connection, repository: 'app' });
  const state = asking(questions, options);
  await h.save(state);
  const [sent] = h.channels.of(connection).sent;
  const delivery = h.notifications.journal.list({})[0]!;
  const act = async (action: string, user = '111', chat = '-100', event?: string) =>
    h.notifications.inbound.handle(connection, {
      type: 'action',
      event: event ?? `u${(counter += 1)}`,
      chat,
      user,
      shortKey: sent!.shortKey,
      action,
    });
  const reply = async (text: string, user = '111', chat = '-100') =>
    h.notifications.inbound.handle(connection, {
      type: 'text',
      event: `u${(counter += 1)}`,
      chat,
      user,
      text,
      target: { shortKey: null, message: String(sent!.ref.message_id) },
    } satisfies InboundInput);
  const answers = () => h.applied.map(({ event }) => (event as { answer: string }).answer);
  return { h, connection, state, delivery, sent: sent!, act, reply, answers };
}

describe('an answer with a button', () => {
  it('answers a question with one button and shows that the answer is sent', async () => {
    const { h, connection, act, answers } = await setup(ONE);
    expect(await act('o:1:2')).toEqual({ kind: 'sent' });
    expect(answers()).toEqual(['Q1: Which database?\nA1: PostgreSQL']);
    expect(h.applied[0]?.event).toMatchObject({ kind: 'answer', group: 'group-1', by: 'human' });
    await h.notifications.dispatcher.idle();
    const last = h.channels.of(connection).updates.at(-1)?.message;
    expect(last).toMatchObject({ state: 'answered', rows: [] });
    expect(last?.status).toBe('Answer sent via main by user 111');
    expect(h.notifications.journal.list({ state: 'closed' })).toHaveLength(1);
  });

  it('replaces the choice of a question and keeps the answer unsent until the last one', async () => {
    const { h, connection, act, answers } = await setup(THREE);
    expect(await act('o:1:1')).toEqual({ kind: 'selected' });
    expect(await act('o:1:2')).toEqual({ kind: 'selected' });
    expect(answers()).toEqual([]);
    const shown = h.channels.of(connection).updates.at(-1)?.message;
    expect(shown?.questions[0]?.answer).toBe('PostgreSQL');
    expect(shown?.questions[0]?.options[1]?.selected).toBe(true);
  });

  it('takes the recommendations where there are any and waits for the question without one', async () => {
    const { h, connection, act, reply, answers } = await setup(THREE);
    expect(await act('o:1:1')).toEqual({ kind: 'selected' });
    expect(await act('r')).toEqual({ kind: 'waiting' });
    expect(answers()).toEqual([]);
    const shown = h.channels.of(connection).updates.at(-1)?.message;
    expect(shown?.questions.map((question) => question.answer)).toEqual(['SQLite', 'yes', null]);
    expect(await reply('3: main')).toEqual({ kind: 'sent' });
    expect(answers()).toEqual([
      'Q1: Which database?\nA1: SQLite\n\nQ2: Add tests?\nA2: yes\n\nQ3: Name?\nA3: main',
    ]);
  });

  it('asks for a text answer with a prompt and counts the questions', async () => {
    const { delivery, act } = await setup(THREE);
    expect(await act('c')).toEqual({ kind: 'prompt', shortKey: expect.any(String), questions: 3 });
    expect(delivery.state).toBe('sent');
  });

  it('refuses a button the question does not have', async () => {
    const { act, answers } = await setup(ONE);
    expect(await act('o:1:9')).toEqual({ kind: 'ignored' });
    expect(await act('o:4:1')).toEqual({ kind: 'ignored' });
    expect(await act('a')).toEqual({ kind: 'ignored' });
    expect(answers()).toEqual([]);
  });
});

describe('an answer with text', () => {
  it('answers the second question with a reply and keeps the button choice of the first', async () => {
    const { act, reply, answers } = await setup(THREE.slice(0, 2));
    await act('o:1:1');
    expect(await reply('2: use PostgreSQL')).toEqual({ kind: 'sent' });
    expect(answers()).toEqual([
      'Q1: Which database?\nA1: SQLite\n\nQ2: Add tests?\nA2: use PostgreSQL',
    ]);
  });

  it('takes the whole text for one question', async () => {
    const { reply, answers } = await setup(ONE);
    expect(await reply('да, конечно')).toEqual({ kind: 'sent' });
    expect(answers()).toEqual(['Q1: Which database?\nA1: да, конечно']);
  });

  it('refuses a text without a number for several questions and changes nothing', async () => {
    const { h, connection, act, reply, answers } = await setup(THREE.slice(0, 2));
    await act('o:1:1');
    expect(await reply('да')).toEqual({ kind: 'format' });
    expect(await reply('5: да')).toEqual({ kind: 'format' });
    expect(answers()).toEqual([]);
    const shown = h.channels.of(connection).updates.at(-1)?.message;
    expect(shown?.questions.map((question) => question.answer)).toEqual(['SQLite', null]);
  });

  it('answers a question without structure with the whole text', async () => {
    const { reply, answers } = await setup(null, { feedback: 'what now?' });
    expect(await reply('go on')).toEqual({ kind: 'sent' });
    expect(answers()).toEqual(['go on']);
  });

  it('ignores a text that answers no message of the bot', async () => {
    const { h, connection } = await setup(ONE);
    const result = await h.notifications.inbound.handle(connection, {
      type: 'text',
      event: 'x1',
      chat: '-100',
      user: '111',
      text: 'hello',
      target: { shortKey: null, message: '99999' },
    });
    expect(result).toEqual({ kind: 'ignored' });
    expect(h.applied).toEqual([]);
  });
});

describe('a review and a request for a person', () => {
  it('accepts a review with Accepted. and the group goes on', async () => {
    const h = harness();
    current = h;
    const connection = await chatConnection(h.base, { params: PARAMS });
    await h.notifications.subscriptions.add({ connection, repository: 'app' });
    const state = asking(null, { feedback: 'step done' });
    state.groups[0]!.humanOnly = 'review';
    await h.save(state);
    const [sent] = h.channels.of(connection).sent;
    expect(sent?.message.rows[0]?.map((action) => action.id)).toEqual(['a', 'f']);
    const result = await h.notifications.inbound.handle(connection, {
      type: 'action',
      event: 'r1',
      chat: '-100',
      user: '111',
      shortKey: sent!.shortKey,
      action: 'a',
    });
    expect(result).toEqual({ kind: 'sent' });
    expect(h.applied[0]?.event).toMatchObject({ answer: 'Accepted.', by: 'human' });
  });

  it('sends the text of a rework as the answer', async () => {
    const h = harness();
    current = h;
    const connection = await chatConnection(h.base, { params: PARAMS });
    await h.notifications.subscriptions.add({ connection, repository: 'app' });
    const state = asking(null, { feedback: 'step done' });
    state.groups[0]!.humanOnly = 'review';
    await h.save(state);
    const [sent] = h.channels.of(connection).sent;
    const rework = await h.notifications.inbound.handle(connection, {
      type: 'action',
      event: 'r2',
      chat: '-100',
      user: '111',
      shortKey: sent!.shortKey,
      action: 'f',
    });
    expect(rework).toMatchObject({ kind: 'prompt', questions: 0 });
    await h.notifications.inbound.handle(connection, {
      type: 'text',
      event: 'r3',
      chat: '-100',
      user: '111',
      text: 'добавь тесты на ошибки',
      target: { shortKey: sent!.shortKey, message: null },
    });
    expect(h.applied[0]?.event).toMatchObject({ answer: 'добавь тесты на ошибки' });
  });

  it('answers a question for a person only as a person', async () => {
    const { h, act } = await setup(ONE, { humanOnly: true });
    expect(await act('o:1:1')).toEqual({ kind: 'sent' });
    expect(h.applied[0]?.event).toMatchObject({ by: 'human' });
  });
});

describe('who may answer', () => {
  it('refuses a user outside the list and leaves the choices alone', async () => {
    const { h, act, answers } = await setup(ONE);
    expect(await act('o:1:1', '999')).toEqual({ kind: 'forbidden' });
    expect(answers()).toEqual([]);
    expect(h.notifications.journal.list({ state: 'sent' })).toHaveLength(1);
  });

  it('refuses a button pressed in another chat', async () => {
    const { act, answers } = await setup(ONE);
    expect(await act('o:1:1', '111', '-999')).toEqual({ kind: 'forbidden' });
    expect(answers()).toEqual([]);
  });

  it('checks the user before it reads the delivery: a wrong key from a stranger is forbidden, not closed', async () => {
    const { h, connection } = await setup(ONE);
    const result = await h.notifications.inbound.handle(connection, {
      type: 'action',
      event: 'z1',
      chat: '-100',
      user: '999',
      shortKey: 'NOSUCHKEY2',
      action: 'o:1:1',
    });
    expect(result).toEqual({ kind: 'forbidden' });
  });

  it('accepts any user of the list', async () => {
    const { act, answers } = await setup(ONE);
    expect(await act('o:1:1', '222')).toEqual({ kind: 'sent' });
    expect(answers()).toHaveLength(1);
  });

  it('answers a delivery of another connection as a closed question', async () => {
    const { h, act } = await setup(ONE);
    const other = await chatConnection(h.base, {
      name: 'other',
      params: { chat_id: '-300', allowed_users: '111' },
    });
    const sent = h.channels.of(h.notifications.journal.list({}).length ? other : other);
    expect(sent.sent).toHaveLength(0);
    expect(await act('o:1:1', '111', '-100')).toEqual({ kind: 'sent' });
    const stolen = await h.notifications.inbound.handle(other, {
      type: 'action',
      event: 'o1',
      chat: '-300',
      user: '111',
      shortKey: h.channels.of(other).sent[0]?.shortKey ?? 'KEYKEYKEYK',
      action: 'o:1:1',
    });
    expect(stolen).toEqual({ kind: 'closed' });
  });
});

describe('repeats and late answers', () => {
  it('applies a repeated event once', async () => {
    const { act, answers } = await setup(THREE);
    expect(await act('o:1:1', '111', '-100', 'same')).toEqual({ kind: 'selected' });
    expect(await act('o:1:2', '111', '-100', 'same')).toEqual({ kind: 'ignored' });
    expect(await act('r', '111', '-100', 'same2')).toEqual({ kind: 'waiting' });
    expect(answers()).toEqual([]);
  });

  it('refuses a press after the question was answered in the panel', async () => {
    const { h, state, act, answers } = await setup(ONE);
    transition(state, { kind: 'answer', group: 'group-1', answer: 'A', by: 'human' }, 5000);
    await h.save(state);
    expect(await act('o:1:1')).toEqual({ kind: 'closed' });
    expect(answers()).toEqual([]);
  });

  it('refuses a press the moment the question closes between the claim and the answer', async () => {
    const { h, state, act, answers } = await setup(ONE);
    // The panel answered, but the dispatcher has not looked yet: the state is checked anyway.
    transition(state, { kind: 'answer', group: 'group-1', answer: 'A', by: 'human' }, 5000);
    h.states.set(state.run.id, state);
    expect(await act('o:1:1')).toEqual({ kind: 'closed' });
    expect(answers()).toEqual([]);
  });

  it('says closed when the engine refuses the answer, and forgets who was about to answer', async () => {
    const { h, act, delivery } = await setup(ONE);
    h.applyError.error = rejected('group is not waiting');
    expect(await act('o:1:1')).toEqual({ kind: 'closed' });
    expect(h.notifications.journal.list({ state: 'sent' })).toHaveLength(1);
    expect(delivery.id).toBeGreaterThan(0);
  });

  it('closes the message of the other subscription naming the channel that answered', async () => {
    const h = harness();
    current = h;
    const first = await chatConnection(h.base, { params: PARAMS });
    const second = await chatConnection(h.base, {
      name: 'second',
      params: { chat_id: '-200', allowed_users: '222' },
    });
    await h.notifications.subscriptions.add({ connection: first, repository: 'app' });
    await h.notifications.subscriptions.add({ connection: second, repository: 'app' });
    await h.save(asking(ONE));
    const sent = h.channels.of(first).sent[0]!;
    await h.notifications.inbound.handle(first, {
      type: 'action',
      event: 'e1',
      chat: '-100',
      user: '111',
      shortKey: sent.shortKey,
      action: 'o:1:1',
    });
    await h.notifications.dispatcher.idle();
    expect(h.channels.of(second).updates.at(-1)?.message.status).toBe(
      'Closed: answered via main by user 111',
    );
    expect(h.channels.of(second).updates.at(-1)?.ref.chat_id).toBe('-200');
  });
});
