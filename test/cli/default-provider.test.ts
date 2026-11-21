import { describe, expect, it } from 'vitest';

import { MANUAL_CONFIG } from '../daemon/harness.ts';
import { aip, sandbox } from './sandbox.ts';

const PROVIDERS = `  providers:
    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }
    zai: { name: Z.ai, access: [{ kind: cli, runtime: claude }] }
`;

const withDefault = (slug: string, disabled = false): string =>
  MANUAL_CONFIG.replace(
    'swarm:\n',
    `swarm:\n${PROVIDERS.replace('zai: { name: Z.ai,', `zai: { name: Z.ai,${disabled ? ' enabled: false,' : ''}`)}  default_provider: ${slug}\n`,
  );

interface Items {
  items: { provider: string | null }[];
}

const queued = async (box: ReturnType<typeof sandbox>): Promise<(string | null)[]> =>
  (JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as Items).items.map(
    (item) => item.provider,
  );

describe('aip queue add with a default provider', () => {
  it('puts the task on the default provider, and --no-provider keeps it without one', async () => {
    const box = sandbox(withDefault('zai'));
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'a')).code).toBe(0);
    expect((await aip(box, 'queue', 'add', 'feature', '--task', 'b', '--no-provider')).code).toBe(
      0,
    );
    expect(
      (await aip(box, 'queue', 'add', 'feature', '--task', 'c', '--provider', 'anthropic')).code,
    ).toBe(0);
    expect(await queued(box)).toEqual(['zai', null, 'anthropic']);
  });

  it('refuses --provider together with --no-provider', async () => {
    const box = sandbox(withDefault('zai'));
    const result = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'x',
      '--provider',
      'zai',
      '--no-provider',
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--no-provider cannot be combined with --provider');
    const run = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'x',
      '--provider',
      'zai',
      '--no-provider',
    );
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('--no-provider cannot be combined with --provider');
  });

  it('takes the default provider in run start, and --no-provider turns it off', async () => {
    const box = sandbox(withDefault('zai'));
    await aip(box, 'queue', 'pause');
    const first = await aip(box, 'run', 'start', 'feature', '--task', 'one', '--json');
    expect(first.code, first.stderr).toBe(0);
    const second = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'two',
      '--no-provider',
      '--json',
    );
    expect(second.code, second.stderr).toBe(0);
    const queue = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as Items & {
      runs: { provider: string | null }[];
    };
    // parallel 1: the first task runs, the second one waits
    expect([...queue.runs, ...queue.items].map((entry) => entry.provider)).toEqual(['zai', null]);
  });
});

describe('the default provider in aip provider', () => {
  it('marks it in the list and in show, and in --json', async () => {
    const box = sandbox(withDefault('zai'));
    const list = await aip(box, 'provider', 'list');
    expect(list.code, list.stderr).toBe(0);
    const rows = list.stdout.trim().split('\n').slice(1);
    expect(rows.find((row) => row.startsWith('zai'))).toContain('default');
    expect(rows.find((row) => row.startsWith('anthropic'))).not.toContain('default');
    const show = await aip(box, 'provider', 'show', 'zai');
    expect(show.stdout).toContain('default: yes (project)');
    expect((await aip(box, 'provider', 'show', 'anthropic')).stdout).not.toContain('default: yes');
    const json = JSON.parse((await aip(box, 'provider', 'list', '--json')).stdout) as {
      defaultProvider: unknown;
    };
    expect(json.defaultProvider).toEqual({ slug: 'zai', level: 'project' });
  });
});

describe('aip config check with a default provider', () => {
  it('prints the default provider', async () => {
    const box = sandbox(withDefault('anthropic'));
    const result = await aip(box, 'config', 'check');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('default: anthropic · project');
    expect(result.stdout).not.toContain('is disabled');
  });

  it('warns about a disabled default provider and still exits with 0', async () => {
    const box = sandbox(withDefault('zai', true));
    const result = await aip(box, 'config', 'check');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Warning: default provider `zai` is disabled');
  });
});
