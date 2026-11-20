import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startFakeTelegram, type FakeTelegram } from '../fakes/telegram-api.ts';
import { SENTINEL } from '../feature/integrations/helpers.ts';

import { aip, aipInput, sandbox, type Sandbox } from './sandbox.ts';

let fake: FakeTelegram | null = null;

afterEach(async () => {
  await fake?.close();
  fake = null;
});

/** A sandbox whose secrets live in a file store and whose Telegram is the fake Bot API. */
async function setup(): Promise<Sandbox> {
  fake = await startFakeTelegram();
  const box = sandbox();
  const keyFile = join(mkdtempSync(join(tmpdir(), 'aip-notify-key-')), 'key');
  writeFileSync(keyFile, 'ab'.repeat(32), { mode: 0o600 });
  return {
    ...box,
    env: {
      ...box.env,
      AIP_SECRETS_BACKEND: 'file',
      AIP_SECRETS_KEY_FILE: keyFile,
      AIP_TELEGRAM_API: fake.base,
    },
  };
}

/** A connection `main` with chat and token, enabled; returns its id. */
async function connection(box: Sandbox, token = fake!.token): Promise<string> {
  const added = await aip(
    box,
    ...['integration', 'add', 'telegram', 'main', '--global', '--json'],
    ...['--param', 'allowed_users=111', '--param', 'chat_id=-1001'],
  );
  expect(added.code).toBe(0);
  const [{ id }] = JSON.parse(added.stdout) as [{ id: string }];
  const stored = await aipInput(
    box,
    `${token}\n`,
    'integration',
    'secret',
    'set',
    id,
    'bot_token',
    '--stdin',
  );
  expect(stored.code).toBe(0);
  expect((await aip(box, 'integration', 'enable', id)).code).toBe(0);
  return id;
}

describe('aip notify', () => {
  it('subscribes the current project, lists and edits the subscription', async () => {
    const box = await setup();
    const id = await connection(box);
    expect((await aip(box, 'repo', 'add', '.')).code).toBe(0);
    const added = await aip(box, 'notify', 'add', id, '--repo', '.', '--events', 'question,failed');
    expect(added.code).toBe(0);
    const list = await aip(box, 'notify', 'list');
    expect(list.stdout).toContain('question, failed');
    expect(list.stdout).toContain('enabled');
    const [{ id: subscription }] = JSON.parse(
      (await aip(box, 'notify', 'list', '--json')).stdout,
    ) as [{ id: string }];

    const edited = await aip(box, 'notify', 'edit', subscription, '--events', 'finished');
    expect(edited.stdout).toContain('finished');
    expect((await aip(box, 'notify', 'disable', subscription)).stdout).toContain('disabled');
    expect((await aip(box, 'notify', 'enable', subscription)).stdout).toContain('enabled');
    const removed = await aip(box, 'notify', 'remove', subscription);
    expect(removed.code).toBe(0);
    expect((await aip(box, 'notify', 'list')).stdout).toContain('No notification subscriptions');
  });

  it('subscribes every project with the default event and shows the connection channel', async () => {
    const box = await setup();
    const id = await connection(box);
    const added = await aip(box, 'notify', 'add', id, '--all-projects', '--json');
    expect(added.code).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject([{ project: null, events: ['question'] }]);
    const channel = await aip(box, 'integration', 'list');
    expect(channel.stdout).toContain('bot_token:set');
    expect(channel.stdout).not.toContain(fake!.token);
  });

  it('refuses a subscription without a scope or with both, and an unknown event', async () => {
    const box = await setup();
    const id = await connection(box);
    const neither = await aip(box, 'notify', 'add', id);
    expect(neither.code).toBe(1);
    expect(neither.stderr).toContain('either --repo');
    const both = await aip(box, 'notify', 'add', id, '--repo', '.', '--all-projects');
    expect(both.code).toBe(1);
    const unknown = await aip(box, 'notify', 'add', id, '--all-projects', '--events', 'nothing');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('unknown event kind');
    const empty = await aip(box, 'notify', 'add', id, '--all-projects', '--events', ',');
    expect(empty.code).toBe(1);
  });

  it('tests the channel, writes the journal, and exits with 1 on a refusal without the token', async () => {
    const box = await setup();
    const id = await connection(box);
    await aip(box, 'notify', 'add', id, '--all-projects');
    const [{ id: subscription }] = JSON.parse(
      (await aip(box, 'notify', 'list', '--json')).stdout,
    ) as [{ id: string }];

    const sent = await aip(box, 'notify', 'test', subscription);
    expect(sent.code).toBe(0);
    expect(fake!.messages.at(-1)).toMatchObject({ chat_id: -1001 });
    const log = await aip(box, 'notify', 'log', '--subscription', subscription);
    expect(log.stdout).toContain('test');
    expect(log.stdout).toContain('sent');
    const json = JSON.parse((await aip(box, 'notify', 'log', '--json')).stdout) as unknown[];
    expect(json).toHaveLength(1);

    const wrong = `999:${SENTINEL}`;
    await aipInput(box, `${wrong}\n`, 'integration', 'secret', 'set', id, 'bot_token', '--stdin');
    const failed = await aip(box, 'notify', 'test', subscription);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('unauthorized');
    expect(failed.stdout + failed.stderr).not.toContain(SENTINEL);
    const failures = await aip(box, 'notify', 'log', '--state', 'failed', '--limit', '5');
    expect(failures.stdout).toContain('failed');
    expect(failures.stdout).not.toContain(SENTINEL);
    const bad = await aip(box, 'notify', 'log', '--limit', '0');
    expect(bad.code).toBe(1);
  });

  it('is listed under Setup & maintenance with every subcommand described and exemplified', async () => {
    const box = await setup();
    const top = (await aip(box, '--help')).stdout;
    const setupGroup = top.slice(top.indexOf('Setup & maintenance:'), top.indexOf('Plumbing'));
    expect(setupGroup).toMatch(/\n\s+notify /);
    const names = ['list', 'add', 'edit', 'enable', 'disable', 'remove', 'test', 'log'];
    const noun = (await aip(box, 'notify', '--help')).stdout;
    for (const name of names) expect(noun).toMatch(new RegExp(`\\n\\s+${name}[ \\[<]`));
    for (const name of names) {
      const help = (await aip(box, 'notify', name, '--help')).stdout;
      expect(help).toContain('Examples:');
      expect(help).toContain(`$ aip notify ${name} `.trimEnd());
    }
  });
});
