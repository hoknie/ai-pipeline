import { execFile } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { SENTINEL } from '../feature/integrations/helpers.ts';

import { aip, aipInput, main, sandbox } from './sandbox.ts';

describe('aip integration', () => {
  it('shows the built-in catalog and no connections, and refuses an unknown kind', async () => {
    const box = sandbox();
    const types = await aip(box, 'integration', 'types');
    expect(types.code).toBe(0);
    expect(types.stdout).toContain('telegram');
    expect(types.stdout).toContain('bot_token*');
    const json = JSON.parse((await aip(box, 'integration', 'types', '--json')).stdout) as {
      kind: string;
    }[];
    expect(json.map((one) => one.kind)).toEqual(['telegram']);
    const list = await aip(box, 'integration', 'list');
    expect(list.stdout).toContain('No integration connections yet.');
    expect((await aip(box, 'integration', 'list', '--json')).stdout.trim()).toBe('[]');
    const added = await aip(box, 'integration', 'add', 'unknown', 'main', '--global');
    expect(added.code).toBe(1);
    expect(added.stderr).toContain('unknown integration kind');
    expect((await aip(box, 'integration', 'list', '--json')).stdout.trim()).toBe('[]');
  });

  it('refuses both scopes at once and a parameter without a value', async () => {
    const box = sandbox();
    const both = await aip(
      box,
      'integration',
      'add',
      'telegram',
      'main',
      '--global',
      '--repo',
      '.',
    );
    expect(both.code).toBe(1);
    expect(both.stderr).toContain('either --repo or --global');
    const bad = await aip(box, 'integration', 'add', 'telegram', 'main', '--param', 'novalue');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('<key>=<value>');
  });

  it('reads a secret from stdin only and never echoes it', async () => {
    const box = sandbox();
    const noFlag = await aip(box, 'integration', 'secret', 'set', 'c1', 'token');
    expect(noFlag.code).toBe(1);
    expect(noFlag.stderr).toContain('--stdin');
    const value = await aip(
      box,
      'integration',
      'secret',
      'set',
      'c1',
      'token',
      '--value',
      SENTINEL,
    );
    expect(value.code).toBe(1);
    expect(value.stderr).toContain('unknown option');
    expect(value.stderr).not.toContain(SENTINEL);
    const empty = await aipInput(
      box,
      '\n',
      'integration',
      'secret',
      'set',
      'c1',
      'token',
      '--stdin',
    );
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain('secret input is empty');
    const huge = await aipInput(
      box,
      `${SENTINEL}${'x'.repeat(20_000)}`,
      'integration',
      'secret',
      'set',
      'c1',
      'token',
      '--stdin',
    );
    expect(huge.code).toBe(1);
    expect(huge.stderr).toContain('too long');
    const unknown = await aipInput(
      box,
      `${SENTINEL}\n`,
      'integration',
      'secret',
      'set',
      'c1',
      'token',
      '--stdin',
    );
    expect(unknown.code).toBe(1);
    for (const out of [empty, huge, unknown]) {
      expect(out.stdout + out.stderr).not.toContain(SENTINEL);
    }
    const removed = await aip(box, 'integration', 'secret', 'remove', 'c1', 'token');
    expect(removed.code).toBe(1);
  });

  it('reads stdin of the real process within a limit, without a trace of it in the output', async () => {
    const box = sandbox();
    const run = (input: string) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          [main, 'integration', 'secret', 'set', 'c1', 'token', '--stdin'],
          { cwd: box.repo, env: box.env, timeout: 60_000 },
          (error, stdout, stderr) =>
            resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
        );
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(input);
      });
    const small = await run(`${SENTINEL}\n`);
    expect(small.code).toBe(1);
    expect(small.out).toContain('connection not found');
    expect(small.out).not.toContain(SENTINEL);
    const large = await run(SENTINEL + 'y'.repeat(100_000));
    expect(large.code).toBe(1);
    expect(large.out).toContain('too long');
    expect(large.out).not.toContain(SENTINEL);
  });

  it('is listed under Setup & maintenance with examples on every command', async () => {
    const box = sandbox();
    const top = (await aip(box, '--help')).stdout;
    const setup = top.slice(top.indexOf('Setup & maintenance:'), top.indexOf('Plumbing'));
    expect(setup).toMatch(/\n\s+integration /);
    const noun = (await aip(box, 'integration', '--help')).stdout;
    for (const name of ['types', 'list', 'add', 'edit', 'remove', 'enable', 'disable', 'secret']) {
      expect(noun).toContain(name);
    }
    for (const path of [
      ['types'],
      ['list'],
      ['add'],
      ['edit'],
      ['remove'],
      ['enable'],
      ['disable'],
      ['secret', 'set'],
      ['secret', 'remove'],
    ]) {
      const help = (await aip(box, 'integration', ...path, '--help')).stdout;
      expect(help).toContain('Examples:');
      expect(help).toContain(`$ aip integration ${path.join(' ')}`);
      expect(help).not.toContain('--value');
    }
  });

  it('edits the parameters of a connection and never takes a secret as a parameter', async () => {
    const box = sandbox();
    const added = await aip(
      box,
      ...['integration', 'add', 'telegram', 'main', '--global', '--json'],
      ...['--param', 'allowed_users=111'],
    );
    expect(added.code).toBe(0);
    const [{ id }] = JSON.parse(added.stdout) as [{ id: string }];
    const edited = await aip(box, 'integration', 'edit', id, '--param', 'chat_id=-1001234567890');
    expect(edited.stderr).toBe('');
    expect(edited.code).toBe(0);
    expect(edited.stdout).toContain('chat_id=-1001234567890');
    expect(edited.stdout).toContain('allowed_users=111');
    expect(edited.stdout).toContain('bot_token:missing');
    const unset = await aip(box, 'integration', 'edit', id, '--unset', 'chat_id');
    expect(unset.code).toBe(0);
    expect(unset.stdout).not.toContain('chat_id');
    const none = await aip(box, 'integration', 'edit', id);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('--param');
    const secret = await aip(box, 'integration', 'edit', id, '--param', `bot_token=${SENTINEL}`);
    expect(secret.code).toBe(1);
    expect(secret.stderr).toContain(`aip integration secret set ${id} bot_token --stdin`);
    expect(secret.stdout + secret.stderr).not.toContain(SENTINEL);
    const bad = await aip(box, 'integration', 'edit', id, '--param', `allowed_users=${SENTINEL}`);
    expect(bad.code).toBe(1);
    expect(bad.stdout + bad.stderr).not.toContain(SENTINEL);
    expect(bad.stderr).toContain('allowed_users');
    const unknown = await aip(box, 'integration', 'edit', id, '--param', 'nothing=1');
    expect(unknown.code).toBe(1);
    const required = await aip(box, 'integration', 'edit', id, '--unset', 'allowed_users');
    expect(required.code).toBe(1);
    const list = (await aip(box, 'integration', 'list', '--json')).stdout;
    expect(list).toContain('"allowed_users": "111"');
  });
});
