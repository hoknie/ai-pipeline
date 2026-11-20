import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startFakeRegistry, type FakeRegistry } from '../fakes/registry-api.ts';
import { SENTINEL } from '../feature/integrations/helpers.ts';

import { aip, aipInput, main, sandbox, type Sandbox } from './sandbox.ts';

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
    expect(json.map((one) => one.kind).sort()).toEqual([
      'service-registry',
      'slack',
      'telegram',
      'webhook',
    ]);
    expect(types.stdout).toContain('service-registry');
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

describe('aip integration with a service registry', () => {
  let fake: FakeRegistry | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  async function setup(): Promise<{ box: Sandbox; registry: FakeRegistry }> {
    const registry = (fake = await startFakeRegistry());
    const box = sandbox();
    const keyFile = join(mkdtempSync(join(tmpdir(), 'aip-registry-key-')), 'key');
    writeFileSync(keyFile, 'cd'.repeat(32), { mode: 0o600 });
    box.env = { ...box.env, AIP_SECRETS_BACKEND: 'file', AIP_SECRETS_KEY_FILE: keyFile };
    return { box, registry };
  }

  async function connection(box: Sandbox, url: string, token: string): Promise<string> {
    const added = await aip(
      box,
      ...['integration', 'add', 'service-registry', 'main', '--global', '--json'],
      ...['--param', `url=${url}`],
    );
    expect(added.stderr).toBe('');
    const [{ id }] = JSON.parse(added.stdout) as [{ id: string }];
    expect(
      (await aipInput(box, `${token}\n`, 'integration', 'secret', 'set', id, 'token', '--stdin'))
        .code,
    ).toBe(0);
    expect((await aip(box, 'integration', 'enable', id)).code).toBe(0);
    return id;
  }

  it('lists the kind and refuses a wrong address without a network call', async () => {
    const { box, registry } = await setup();
    const types = await aip(box, 'integration', 'types');
    expect(types.stdout).toContain('service-registry');
    expect(types.stdout).toContain('url*');
    expect(types.stdout).toContain('token*');
    for (const url of ['ftp://registry.example.com', 'https://user:pass@registry.example.com']) {
      const bad = await aip(
        box,
        'integration',
        'add',
        'service-registry',
        'main',
        '--global',
        '--param',
        `url=${url}`,
      );
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain('invalid connection parameters: url');
      expect(bad.stderr).not.toContain('pass');
    }
    expect((await aip(box, 'integration', 'list', '--json')).stdout.trim()).toBe('[]');
    expect(registry.requests).toEqual([]);
  });

  it('prints ok with the number of tools and shows the result in the list', async () => {
    const { box, registry } = await setup();
    const id = await connection(box, registry.base, registry.token);
    const checked = await aip(box, 'integration', 'check', id);
    expect(checked.code).toBe(0);
    expect(checked.stdout.trim()).toBe('ok, 3 tools');
    const list = await aip(box, 'integration', 'list', '--json');
    const [view] = JSON.parse(list.stdout) as [{ lastCheck: { ok: boolean; count: number } }];
    expect(view.lastCheck).toMatchObject({ ok: true, count: 3 });
    expect((await aip(box, 'integration', 'list')).stdout).toContain('ok, 3 tools');
    expect(checked.stdout + checked.stderr + list.stdout).not.toContain(registry.token);
  });

  it('prints the code of the failure and never the token', async () => {
    const { box, registry } = await setup();
    const id = await connection(box, registry.base, 'svcp_revoked-token');
    const checked = await aip(box, 'integration', 'check', id);
    expect(checked.code).toBe(0);
    expect(checked.stdout.trim()).toBe('failed: unauthorized');
    expect(checked.stdout + checked.stderr).not.toContain('svcp_revoked-token');
    const json = await aip(box, 'integration', 'check', id, '--json');
    expect(JSON.parse(json.stdout)).toMatchObject({
      lastCheck: { ok: false, code: 'unauthorized' },
    });
  });

  it('refuses a disabled connection and a kind without a check', async () => {
    const { box, registry } = await setup();
    const id = await connection(box, registry.base, registry.token);
    await aip(box, 'integration', 'disable', id);
    const refused = await aip(box, 'integration', 'check', id);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('disabled');
    expect(registry.requests).toEqual([]);
    const other = await aip(
      box,
      'integration',
      'add',
      'telegram',
      'main',
      '--global',
      '--json',
      '--param',
      'allowed_users=111',
      '--param',
      'chat_id=-1',
    );
    const [{ id: telegram }] = JSON.parse(other.stdout) as [{ id: string }];
    const none = await aip(box, 'integration', 'check', telegram);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('this kind has no check');
  });

  it('lists the skills of the registry as registry:<name> with the versions', async () => {
    const { box, registry } = await setup();
    registry.skills.push(
      {
        id: 'sk-1',
        name: 'go-testing',
        title: 'Go testing',
        tags: ['go'],
        versions: { '1.2.0': Buffer.alloc(0), '1.4.1': Buffer.alloc(0) },
      },
      { id: 'sk-2', name: 'sql-review', versions: { '2.0.0': Buffer.alloc(0) } },
    );
    const id = await connection(box, registry.base, registry.token);
    const all = await aip(box, 'integration', 'skills', id);
    expect(all.code).toBe(0);
    expect(all.stdout).toContain('registry:go-testing');
    expect(all.stdout).toContain('1.4.1, 1.2.0');
    expect(all.stdout).toContain('registry:sql-review');
    const found = JSON.parse(
      (await aip(box, 'integration', 'skills', id, '--query', 'go', '--json')).stdout,
    ) as {
      name: string;
      versions: string[];
    }[];
    expect(found.map((one) => one.name)).toEqual(['go-testing']);
    expect(found[0]?.versions).toEqual(['1.4.1', '1.2.0']);
    expect(all.stdout + all.stderr).not.toContain(registry.token);
    const help = (await aip(box, 'integration', 'skills', '--help')).stdout;
    expect(help).toContain('$ aip integration skills');
  });

  it('refuses a disabled connection and a kind that is not a registry', async () => {
    const { box, registry } = await setup();
    const id = await connection(box, registry.base, registry.token);
    await aip(box, 'integration', 'disable', id);
    const disabled = await aip(box, 'integration', 'skills', id);
    expect(disabled.code).toBe(1);
    expect(disabled.stderr).toContain('cannot list skills');
    const unknown = await aip(box, 'integration', 'skills', 'nope');
    expect(unknown.code).toBe(1);
  });

  describe('link', () => {
    const API = {
      path: 'acme/backend/api',
      name: 'api',
      repo_url: 'https://github.com/acme/api',
    };

    async function linked(): Promise<{ box: Sandbox; registry: FakeRegistry; id: string }> {
      const { box, registry } = await setup();
      registry.projects = [
        API,
        { path: 'acme/legacy/api', name: 'legacy', repo_url: 'https://example.com/legacy' },
      ];
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/api.git'], {
        cwd: box.repo,
      });
      expect((await aip(box, 'repo', 'add', box.repo)).code).toBe(0);
      const id = await connection(box, registry.base, registry.token);
      return { box, registry, id };
    }

    it('matches by origin on --auto and shows the link in the list of the project', async () => {
      const { box, id } = await linked();
      const auto = await aip(box, 'integration', 'link', id, '--repo', '.', '--auto');
      expect(auto.stderr).toBe('');
      expect(auto.stdout).toContain('acme/backend/api (auto)');
      const list = await aip(box, 'integration', 'list', '--repo', '.');
      expect(list.stdout).toContain('acme/backend/api (auto)');
      const byName = await aip(
        box,
        'integration',
        'link',
        'main',
        '--repo',
        '.',
        '--auto',
        '--json',
      );
      expect(JSON.parse(byName.stdout)).toMatchObject({ registryPath: 'acme/backend/api' });
    });

    it('rejects a path that does not exist and keeps a manual link over --auto', async () => {
      const { box, id } = await linked();
      const missing = await aip(
        box,
        'integration',
        'link',
        id,
        '--repo',
        '.',
        '--path',
        'acme/none',
      );
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain('project acme/none is not found in the service registry');
      const manual = await aip(
        box,
        'integration',
        'link',
        id,
        '--repo',
        '.',
        '--path',
        'acme/legacy/api',
      );
      expect(manual.code).toBe(0);
      expect(manual.stdout).toContain('acme/legacy/api (manual)');
      const again = await aip(box, 'integration', 'link', id, '--repo', '.', '--auto');
      expect(again.stdout).toContain('acme/legacy/api (manual)');
      const list = await aip(box, 'integration', 'list', '--repo', '.');
      expect(list.stdout).toContain('acme/legacy/api (manual)');
    });

    it('clears the link and asks for exactly one action', async () => {
      const { box, id } = await linked();
      await aip(box, 'integration', 'link', id, '--repo', '.', '--auto');
      const cleared = await aip(box, 'integration', 'link', id, '--repo', '.', '--clear');
      expect(cleared.code).toBe(0);
      expect(cleared.stdout).toContain('not linked');
      expect(cleared.stdout).toContain('disabled');
      const none = await aip(box, 'integration', 'link', id, '--repo', '.');
      expect(none.code).toBe(1);
      expect(none.stderr).toContain('exactly one of --path, --auto and --clear');
      const two = await aip(box, 'integration', 'link', id, '--repo', '.', '--auto', '--clear');
      expect(two.code).toBe(1);
    });
  });
});
