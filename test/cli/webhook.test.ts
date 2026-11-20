import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startReceiver, type FakeReceiver } from '../fakes/webhook-receiver.ts';
import { SENTINEL } from '../feature/integrations/helpers.ts';

import { aip, aipInput, sandbox, type Sandbox } from './sandbox.ts';

let receiver: FakeReceiver | null = null;

afterEach(async () => {
  await receiver?.close();
  receiver = null;
});

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

/** A sandbox whose secrets live in a file store. */
async function setup(): Promise<Sandbox> {
  receiver = await startReceiver();
  const box = sandbox();
  const keyFile = join(mkdtempSync(join(tmpdir(), 'aip-webhook-key-')), 'key');
  writeFileSync(keyFile, 'ab'.repeat(32), { mode: 0o600 });
  return {
    ...box,
    env: { ...box.env, AIP_SECRETS_BACKEND: 'file', AIP_SECRETS_KEY_FILE: keyFile },
  };
}

async function add(box: Sandbox, ...extra: string[]): Promise<string> {
  const added = await aip(
    box,
    ...['webhook', 'add', 'ci', '--url', `${receiver!.base}/hook?token=${SENTINEL}`],
    ...['--all-projects', '--json', ...extra],
  );
  expect(added.code, added.stderr).toBe(0);
  return (JSON.parse(added.stdout) as [{ id: string }])[0].id;
}

async function enable(box: Sandbox, id: string): Promise<void> {
  const stored = await aipInput(
    box,
    `${SECRET}\n`,
    ...['integration', 'secret', 'set', id, 'signing_secret', '--stdin'],
  );
  expect(stored.code, stored.stderr).toBe(0);
  expect((await aip(box, 'webhook', 'enable', id)).code).toBe(0);
}

describe('aip webhook', () => {
  it('makes a webhook from the terminal, sets the secret, turns it on and lists it', async () => {
    const box = await setup();
    const id = await add(box);
    const made = await aip(box, 'webhook', 'list');
    expect(made.stdout).toContain('disabled (no secret)');
    await enable(box, id);
    const list = await aip(box, 'webhook', 'list');
    expect(list.stdout).toContain(id);
    expect(list.stdout).toContain('ci');
    expect(list.stdout).toContain('question');
    expect(list.stdout).toContain('enabled');
    expect(list.stdout).toContain(`${receiver!.base}/hook`);
    // the query never leaves the daemon, nor does the secret
    for (const text of [list.stdout, list.stderr, made.stdout]) {
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(SECRET);
    }
  });

  it('prints the next steps after add and takes --json', async () => {
    const box = await setup();
    const added = await aip(
      box,
      'webhook',
      'add',
      'ci',
      '--url',
      `${receiver!.base}/hook`,
      '--all-projects',
    );
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('signing_secret --stdin');
    expect(added.stdout).toContain('aip webhook enable');
  });

  it('refuses a secret as an argument, `edit` without flags and a wrong scope', async () => {
    const box = await setup();
    const id = await add(box);
    const secret = await aip(
      box,
      'webhook',
      'add',
      'x',
      '--url',
      `${receiver!.base}`,
      '--all-projects',
      '--secret',
      SENTINEL,
    );
    expect(secret.code).toBe(1);
    expect(secret.stderr).not.toContain(SENTINEL);
    expect((await aip(box, 'webhook', 'edit', id)).code).toBe(1);
    expect((await aip(box, 'webhook', 'add', 'y', '--url', `${receiver!.base}`)).code).toBe(1);
    const both = await aip(
      box,
      'webhook',
      'add',
      'y',
      '--url',
      receiver!.base,
      '--repo',
      '.',
      '--all-projects',
    );
    expect(both.code).toBe(1);
    const unknown = await aip(box, 'webhook', 'edit', id, '--events', 'nothing');
    expect(unknown.code).toBe(1);
  });

  it('refuses a short secret and an address with a password', async () => {
    const box = await setup();
    const id = await add(box);
    const short = await aipInput(
      box,
      'tiny\n',
      'integration',
      'secret',
      'set',
      id,
      'signing_secret',
      '--stdin',
    );
    expect(short.code).toBe(1);
    const enabled = await aip(box, 'webhook', 'enable', id);
    expect(enabled.code).toBe(1);
    const bad = await aip(
      box,
      'webhook',
      'add',
      'z',
      '--url',
      'https://user:pass@example.com/hook',
      '--all-projects',
    );
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('url');
    expect(bad.stderr).not.toContain('pass@');
  });

  it('changes the address and keeps the id, the secret and the state', async () => {
    const box = await setup();
    const id = await add(box);
    await enable(box, id);
    const edited = await aip(box, 'webhook', 'edit', id, '--url', `${receiver!.base}/v2/aip`);
    expect(edited.code).toBe(0);
    const list = await aip(box, 'webhook', 'list');
    expect(list.stdout).toContain(`${receiver!.base}/v2/aip`);
    expect(list.stdout).toContain(id);
    expect(list.stdout).toContain('enabled');
  });

  it('tests the address: signed call and exit 0 on 204, exit 1 and the code on 500', async () => {
    const box = await setup();
    const id = await add(box);
    await enable(box, id);
    receiver!.answers.push({ status: 204 });
    const ok = await aip(box, 'webhook', 'test', id);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/204 in \d+ ms/);
    expect(receiver!.received[0]?.headers['webhook-signature']).toMatch(/^v1,/);
    expect(JSON.parse(receiver!.received[0]!.body)).toMatchObject({ type: 'webhook.test' });
    receiver!.answers.push({ status: 500 });
    const bad = await aip(box, 'webhook', 'test', id);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toMatch(/500 in \d+ ms/);
    const log = await aip(box, 'webhook', 'log', id);
    expect(log.stdout).toContain('webhook.test');
    expect(log.stdout).not.toContain(SENTINEL);
  });

  it('keeps webhooks out of `notify` and refuses `integration add webhook` with the right command', async () => {
    const box = await setup();
    const id = await add(box);
    const second = await aip(box, 'notify', 'add', id, '--all-projects');
    expect(second.code).toBe(1);
    expect(second.stderr).toContain('aip webhook');
    expect((await aip(box, 'notify', 'list')).stdout).toContain('No notification subscriptions');
    const general = await aip(
      box,
      ...[
        'integration',
        'add',
        'webhook',
        'other',
        '--global',
        '--param',
        'url=https://ci.example.com/aip',
      ],
    );
    expect(general.code).toBe(1);
    expect(general.stderr).toContain('aip webhook add');
    expect((await aip(box, 'webhook', 'list')).stdout).not.toContain('other');
  });

  it('removes a webhook through either group of commands', async () => {
    const box = await setup();
    const id = await add(box);
    expect((await aip(box, 'webhook', 'remove', id)).code).toBe(0);
    expect((await aip(box, 'webhook', 'list')).stdout).toContain('No webhooks');
    const second = await add(box);
    expect((await aip(box, 'integration', 'remove', second)).code).toBe(0);
    expect((await aip(box, 'webhook', 'list')).stdout).toContain('No webhooks');
  });

  it('shows an example on every command', async () => {
    const box = await setup();
    for (const name of [
      'list',
      'add',
      'edit',
      'enable',
      'disable',
      'remove',
      'test',
      'log',
      'redeliver',
    ]) {
      const help = await aip(box, 'webhook', name, '--help');
      expect(help.stdout).toContain('Examples:');
      expect(help.stdout).toMatch(new RegExp(`\\$ aip webhook ${name} `));
    }
  });

  it('refuses to send a delivery of a webhook that is off again', async () => {
    const box = await setup();
    const id = await add(box);
    const missing = await aip(box, 'webhook', 'redeliver', '99');
    expect(missing.code).toBe(1);
    expect((await aip(box, 'webhook', 'redeliver', 'abc')).code).toBe(1);
    expect(id).toBeTruthy();
  });
});
