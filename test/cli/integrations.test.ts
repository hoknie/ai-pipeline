import { execFile } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { SENTINEL } from '../feature/integrations/helpers.ts';

import { aip, aipInput, main, sandbox } from './sandbox.ts';

describe('aip integration', () => {
  it('shows an empty catalog and no connections, and refuses an unknown kind', async () => {
    const box = sandbox();
    const types = await aip(box, 'integration', 'types');
    expect(types.code).toBe(0);
    expect(types.stdout).toContain('No integration kinds are built into this version.');
    expect(JSON.parse((await aip(box, 'integration', 'types', '--json')).stdout)).toEqual([]);
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
    const both = await aip(box, 'integration', 'add', 'example', 'main', '--global', '--repo', '.');
    expect(both.code).toBe(1);
    expect(both.stderr).toContain('either --repo or --global');
    const bad = await aip(box, 'integration', 'add', 'example', 'main', '--param', 'novalue');
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
    for (const name of ['types', 'list', 'add', 'remove', 'enable', 'disable', 'secret']) {
      expect(noun).toContain(name);
    }
    for (const path of [
      ['types'],
      ['list'],
      ['add'],
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
});
