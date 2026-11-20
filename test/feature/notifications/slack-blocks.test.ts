import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slackChannelFactory } from '../../../src/feature/notifications/clients/slack/channel.ts';
import {
  BLOCK_LIMIT,
  escapeMrkdwn,
  renderMessage,
  SECTION_LIMIT,
  type Block,
} from '../../../src/feature/notifications/clients/slack/blocks.ts';
import type { ChatChannelPort } from '../../../src/feature/notifications/ports/index.ts';
import {
  ChannelFailure,
  chatMessage,
  type Draw,
  type EventData,
} from '../../../src/feature/notifications/types/index.ts';
import { blocksProblem, startFakeSlack, type FakeSlack } from '../../fakes/slack-api.ts';

import { eventData } from './helpers.ts';

const KEY = 'ABCDEFGHIJ';
const CHANNEL = 'C0123456789';
const USER = 'U01AAAAAAA';

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
      publicUrl: 'https://aip.example/ui',
      limits,
    });

const question = (text: string, options: string[] = [], recommendation: string | null = null) => ({
  text,
  options,
  recommendation,
});

const options = (count: number) => Array.from({ length: count }, (_, at) => `variant ${at + 1}`);

const render = (patch: Partial<EventData>) => renderMessage(drawOf(patch), KEY, 'en');

/** Every element of every actions block. */
function elements(blocks: Block[]): Record<string, any>[] {
  return blocks.flatMap((block) =>
    block.type === 'actions' ? (block.elements as Record<string, any>[]) : [],
  );
}

describe('slack blocks: layout', () => {
  it('draws the task, the details, the questions and the service buttons', () => {
    const { text, blocks } = render({
      title: 'Add login',
      questions: [question('OAuth or password?', ['OAuth', 'password'], 'OAuth')],
    });
    expect(text).toBe('Question #1 Add login');
    expect(blocks.map((block) => block.type)).toEqual([
      'header',
      'context',
      'section',
      'actions',
      'actions',
    ]);
    const details = (blocks[1]!.elements as { text: string }[]).map((one) => one.text);
    expect(details).toContain('Project: app');
    expect(
      details.some((line) => line.includes('<https://aip.example/ui/#runs/r1/g|Open the task>')),
    ).toBe(true);
    const section = (blocks[2]!.text as { text: string }).text;
    expect(section).toContain('*1.* OAuth or password?');
    expect(section).toContain('1.1 OAuth ⭐');
    expect(section).toContain('_waiting for an answer_');
    expect(elements(blocks).map((one) => one.action_id)).toEqual([
      `${KEY}:o:1:1`,
      `${KEY}:o:1:2`,
      `${KEY}:r`,
      `${KEY}:c`,
    ]);
    expect(elements(blocks).map((one) => one.text.text)).toEqual([
      '⭐ 1.1 OAuth',
      '1.2 password',
      'Accept recommendations',
      'Custom answer',
    ]);
  });

  it('draws the review buttons of a step', () => {
    const { blocks } = render({ humanOnly: 'review', summary: 'plan is ready' });
    expect(elements(blocks).map((one) => one.action_id)).toEqual([`${KEY}:a`, `${KEY}:f`]);
  });

  it('escapes &, < and > of every text, so nothing becomes a mention or a link', () => {
    expect(escapeMrkdwn('<!channel> & <@U1>')).toBe('&lt;!channel&gt; &amp; &lt;@U1&gt;');
    const { blocks, text } = render({
      title: '<b>&',
      questions: [question('use <!here> & more?', ['a<b'])],
    });
    expect(text).not.toContain('<b>');
    expect(text).toContain('&lt;b&gt;&amp;');
    const texts = JSON.stringify(blocks);
    expect(texts).not.toContain('<!here>');
    expect(texts).toContain('use &lt;!here&gt; &amp; more?');
    expect(texts).toContain('a&lt;b');
  });

  it('puts up to five variants on buttons and more in one drop-down list', () => {
    const five = render({ questions: [question('Which?', options(5))] });
    expect(elements(five.blocks).filter((one) => one.type === 'button')).toHaveLength(5 + 1);
    const eight = render({ questions: [question('Which?', options(8), 'variant 6')] });
    const select = elements(eight.blocks).find((one) => one.type === 'static_select')!;
    expect(select.action_id).toBe(`${KEY}:o:1`);
    expect(select.options.map((one: { value: string }) => one.value)).toEqual(
      options(8).map((_, at) => String(at + 1)),
    );
    expect(select.options[5].text.text).toBe('⭐ 1.6 variant 6');
    // only the two service buttons are left
    expect(elements(eight.blocks).filter((one) => one.type === 'button')).toHaveLength(2);
  });

  it('shortens the label of a long variant and keeps its whole text in the section', () => {
    const long = 'x'.repeat(200);
    const { blocks } = render({ questions: [question('Which?', [long, 'short'])] });
    const [first] = elements(blocks);
    expect([...first!.text.text].length).toBeLessThanOrEqual(75);
    expect(first!.text.text).toMatch(/^1\.1 x+…$/);
    expect((blocks[2]!.text as { text: string }).text).toContain(`1.1 ${long}`);
  });

  it('never puts the text of a question or an answer in an action_id or a value', () => {
    const secret = 'highly-specific-question-text';
    const { blocks } = render({
      questions: [question(secret, ['option-text-1', 'option-text-2'], 'option-text-1')],
    });
    for (const element of elements(blocks)) {
      expect(element.action_id).toMatch(/^ABCDEFGHIJ:[a-z](:\d+){0,2}$/);
      expect(JSON.stringify([element.action_id, element.value])).not.toMatch(/text|specific/);
    }
    const eight = render({ questions: [question(secret, options(8))] });
    for (const option of elements(eight.blocks).find((one) => one.type === 'static_select')!
      .options) {
      expect(option.value).toMatch(/^\d+$/);
    }
  });

  it('keeps the message within the limits of Block Kit and every option on a button', () => {
    const huge = 'word '.repeat(2000);
    const { blocks } = render({
      question: huge,
      questions: [question(huge, ['one', 'two', 'three', huge])],
    });
    for (const block of blocks) {
      if (block.type === 'section') {
        expect([...(block.text as { text: string }).text].length).toBeLessThanOrEqual(
          SECTION_LIMIT,
        );
      }
    }
    expect(elements(blocks).filter((one) => one.action_id.includes(':o:'))).toHaveLength(4);
    expect(blocksProblem(blocks)).toBeNull();
  });

  it('keeps the blocks of a very long message under 50 and the service row', () => {
    const many = Array.from({ length: 40 }, (_, at) => question(`Q${at}`, ['a', 'b']));
    const { blocks } = render({ questions: many });
    expect(blocks.length).toBeLessThanOrEqual(BLOCK_LIMIT);
    expect(elements(blocks).at(-1)!.action_id).toBe(`${KEY}:c`);
    expect(blocksProblem(blocks)).toBeNull();
  });

  it('draws a closed message without buttons and says who closed it', () => {
    const { blocks } = renderMessage(
      drawOf({ questions: [question('Which?', ['a', 'b'])] }, { by: 'human' } as never),
      KEY,
      'en',
    );
    expect(blocks.some((block) => block.type === 'actions')).toBe(false);
    const context = blocks.at(-1)!;
    expect(JSON.stringify(context)).toContain('answered by a person outside the bot');
  });
});

describe('slack blocks: identifiers', () => {
  const ids = (blocks: Block[]) => ({
    blocks: blocks.map((block) => block.block_id as string),
    actions: elements(blocks).map((one) => one.action_id as string),
  });

  it('are unique in a message of two questions with three variants each', () => {
    const { blocks } = render({
      questions: [question('One?', ['a', 'b', 'c']), question('Two?', ['d', 'e', 'f'], 'e')],
    });
    const { blocks: blockIds, actions } = ids(blocks);
    expect(blockIds.every((id) => typeof id === 'string' && id.startsWith(`${KEY}:`))).toBe(true);
    expect(new Set(blockIds).size).toBe(blockIds.length);
    expect(new Set(actions).size).toBe(actions.length);
    // the six buttons of the variants, the two service buttons
    expect(actions).toHaveLength(8);
    expect(blockIds).toEqual(
      expect.arrayContaining([`${KEY}:q:1`, `${KEY}:a:1`, `${KEY}:q:2`, `${KEY}:a:2`, `${KEY}:s`]),
    );
    expect(actions).toContain(`${KEY}:o:2:3`);
    expect(blocksProblem(blocks)).toBeNull();
  });

  it('are unique in a message with a drop-down list next to buttons', () => {
    const { blocks } = render({
      questions: [question('Few?', ['a', 'b']), question('Many?', options(8))],
    });
    const { blocks: blockIds, actions } = ids(blocks);
    expect(new Set(blockIds).size).toBe(blockIds.length);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toContain(`${KEY}:o:2`);
    expect(actions).toContain(`${KEY}:o:1:2`);
    expect(blocksProblem(blocks)).toBeNull();
  });

  it('keep the block_id of every block between the first draw and the update', () => {
    const asked = render({ questions: [question('One?', ['a', 'b']), question('Two?', ['c'])] });
    const answered = renderMessage(
      (limits) => ({
        ...drawOf({ questions: [question('One?', ['a', 'b']), question('Two?', ['c'])] })(limits),
        questions: drawOf({ questions: [question('One?', ['a', 'b']), question('Two?', ['c'])] })(
          limits,
        ).questions.map((one, at) => (at === 0 ? { ...one, answer: 'a' } : one)),
      }),
      KEY,
      'en',
    );
    const closed = renderMessage(
      drawOf({ questions: [question('One?', ['a', 'b']), question('Two?', ['c'])] }, {
        by: 'human',
      } as never),
      KEY,
      'en',
    );
    const stable = (rendered: { blocks: Block[] }, ofBlocks: Block[]) =>
      rendered.blocks
        .filter((block) => ofBlocks.some((one) => one.block_id === block.block_id))
        .map((block) => block.block_id);
    for (const later of [answered, closed]) {
      // a block that is still there keeps its identifier and its type
      for (const block of later.blocks.filter((one) => one.block_id !== `${KEY}:t`)) {
        const before = asked.blocks.find((one) => one.block_id === block.block_id);
        if (before !== undefined) expect(before.type).toBe(block.type);
      }
      expect(stable(later, asked.blocks)).toEqual(
        expect.arrayContaining([`${KEY}:h`, `${KEY}:q:1`]),
      );
    }
    expect(blocksProblem(answered.blocks)).toBeNull();
    expect(blocksProblem(closed.blocks)).toBeNull();
  });

  it('are rejected by the fake Slack when repeated (the guard against a regression)', () => {
    const button = (id: string) => ({ type: 'button', action_id: id, text: { text: 'x' } });
    expect(
      blocksProblem([{ type: 'actions', block_id: 'b', elements: [button('a'), button('a')] }]),
    ).toMatch(/duplicate action_id/);
    expect(
      blocksProblem([
        { type: 'actions', block_id: 'b', elements: [button('a')] },
        { type: 'section', block_id: 'b' },
      ]),
    ).toMatch(/duplicate block_id/);
  });
});

describe('slack channel: messages and errors', () => {
  let slack: FakeSlack;
  let alive: ChatChannelPort[];

  beforeEach(async () => {
    slack = await startFakeSlack();
    alive = [];
  });
  afterEach(async () => {
    await slack.close();
  });

  function channel(
    params: Record<string, string> = {},
    tokens: { bot?: string | null; app?: string | null } = {},
  ): ChatChannelPort {
    const factory = slackChannelFactory({ base: slack.base, proxy: () => null });
    const made = factory.create({
      connection: {
        id: 'c1',
        name: 'main',
        kind: 'slack',
        params: { channel_id: CHANNEL, allowed_users: USER, ...params },
      },
      secret: (slot) =>
        Promise.resolve(
          slot === 'bot_token'
            ? tokens.bot === undefined
              ? slack.botToken
              : tokens.bot
            : tokens.app === undefined
              ? slack.appToken
              : tokens.app,
        ),
      cursor: { get: () => null, set: () => undefined },
    });
    alive.push(made);
    return made;
  }

  it('sends blocks with a fallback text to the channel and returns where it landed', async () => {
    const ref = await channel().send(
      drawOf({ title: 'Task', questions: [question('Which?', ['a', 'b'])] }),
      KEY,
    );
    const [message] = slack.messages;
    expect(ref).toEqual({ chat_id: CHANNEL, message_id: message!.ts });
    expect(message!.channel).toBe(CHANNEL);
    expect(message!.text).toBe('Question #1 Task');
    expect(message!.blocks.length).toBeGreaterThan(2);
    expect(slack.callsOf('chat.postMessage')[0]!.token).toBe(slack.botToken);
  });

  it('updates the message with the same block_id and drops the buttons when closed', async () => {
    const target = channel();
    const patch = { questions: [question('Which?', ['a', 'b'])] };
    const ref = await target.send(drawOf(patch), KEY);
    const before = slack.messages[0]!.blocks.map((block) => block.block_id);
    await target.update(ref, drawOf(patch, { by: 'human' } as never), KEY);
    const after = slack.messages[0]!.blocks;
    expect(slack.callsOf('chat.update')[0]!.body).toMatchObject({
      channel: CHANNEL,
      ts: ref.message_id,
    });
    expect(after.some((block) => block.type === 'actions')).toBe(false);
    for (const block of after) {
      if (block.block_id !== `${KEY}:t`) expect(before).toContain(block.block_id);
    }
  });

  it('checks the token first when the test message is sent, and warns about a missing scope', async () => {
    const ref = await channel().sendText('hello <b>');
    expect(slack.calls.map((call) => call.method)).toEqual(['auth.test', 'chat.postMessage']);
    expect(slack.messages[0]!.text).toBe('hello <b>');
    expect(ref.chat_id).toBe(CHANNEL);
    slack.scopes = 'chat:write';
    await channel({ language: 'ru' }).sendText('hello');
    expect(slack.messages[1]!.text).toContain('channels:history');
    expect(slack.messages[1]!.text).toContain('Внимание');
  });

  it('gives up on not_in_channel at once with a hint to invite the app', async () => {
    slack.failures.set('chat.postMessage', [{ error: 'not_in_channel' }]);
    const error = (await channel()
      .send(drawOf({}), KEY)
      .catch((caught: unknown) => caught)) as ChannelFailure;
    expect(error).toBeInstanceOf(ChannelFailure);
    expect(error).toMatchObject({ permanent: true, unauthorized: false });
    expect(error.message).toContain('invite the app');
  });

  it.each(['channel_not_found', 'is_archived', 'invalid_blocks'])(
    'gives up on %s with a safe description',
    async (code) => {
      slack.failures.set('chat.postMessage', [{ error: code }]);
      const error = (await channel()
        .send(drawOf({}), KEY)
        .catch((caught: unknown) => caught)) as ChannelFailure;
      expect(error).toMatchObject({ permanent: true });
      expect(error.message).toBe(`slack refused: ${code}`);
    },
  );

  it('reports invalid_auth, and a missing token, as an authorization error and never shows a token', async () => {
    const wrong = (await channel({}, { bot: 'xoxb-wrong-secret' })
      .send(drawOf({}), KEY)
      .catch((caught: unknown) => caught)) as ChannelFailure;
    expect(wrong).toMatchObject({ permanent: true, unauthorized: true });
    expect(wrong.message).not.toContain('wrong-secret');
    await expect(channel({}, { bot: null }).send(drawOf({}), KEY)).rejects.toMatchObject({
      unauthorized: true,
    });
    slack.failures.set('chat.postMessage', [{ error: 'account_inactive' }]);
    await expect(channel().send(drawOf({}), KEY)).rejects.toMatchObject({ unauthorized: true });
  });

  it('turns 429 with Retry-After into the pause Slack asked for', async () => {
    slack.failures.set('chat.postMessage', [{ status: 429, retryAfter: 7 }]);
    const error = (await channel()
      .send(drawOf({}), KEY)
      .catch((caught: unknown) => caught)) as ChannelFailure;
    expect(error).toMatchObject({ permanent: false, retryAfterMs: 7000, unauthorized: false });
  });

  it('retries a server error and does not name the address in a network error', async () => {
    slack.failures.set('chat.postMessage', [{ status: 503, error: 'service_unavailable' }]);
    await expect(channel().send(drawOf({}), KEY)).rejects.toMatchObject({ permanent: false });
    const dead = slackChannelFactory({ base: 'http://127.0.0.1:1/api', proxy: () => null }).create({
      connection: { id: 'c', name: 'n', kind: 'slack', params: { channel_id: CHANNEL } },
      secret: () => Promise.resolve(slack.botToken),
      cursor: { get: () => null, set: () => undefined },
    });
    const error = (await dead.sendText('x').catch((caught: unknown) => caught)) as ChannelFailure;
    expect(error.permanent).toBe(false);
    expect(error.message).not.toContain('127.0.0.1');
    expect(error.message).not.toContain(slack.botToken);
  });

  it('refuses to send without channel_id', async () => {
    const bare = slackChannelFactory({ base: slack.base, proxy: () => null }).create({
      connection: { id: 'c', name: 'n', kind: 'slack', params: { allowed_users: USER } },
      secret: () => Promise.resolve(slack.botToken),
      cursor: { get: () => null, set: () => undefined },
    });
    await expect(bare.send(drawOf({}), KEY)).rejects.toMatchObject({ permanent: true });
    expect(slack.calls).toHaveLength(0);
  });
});
