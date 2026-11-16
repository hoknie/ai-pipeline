import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PIPELINE_CONFIG } from '../daemon/harness.ts';
import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { aip, sandbox } from './sandbox.ts';

describe('cli: the global queue', () => {
  const globalBox = () => {
    const box = sandbox();
    mkdirSync(join(box.env.XDG_CONFIG_HOME!, 'aip'), { recursive: true });
    writeFileSync(
      join(box.env.XDG_CONFIG_HOME!, 'aip', 'settings.yaml'),
      'queue: { scope: global, max: 3 }\n',
    );
    return box;
  };

  it('lists the global queue with the project of every task', async () => {
    const box = globalBox();
    await aip(box, 'queue', 'add', 'feature', '--task', 'first task');
    const list = await aip(box, 'queue', 'list');
    expect(list.code).toBe(0);
    expect(list.stdout).toContain('Global queue: stopped, parallel 1');
    expect(list.stdout).toContain('at most 3 specialists at once');
    expect(list.stdout).toContain('first task');
    expect(list.stderr).not.toContain('--repo is ignored');
    const json = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout);
    expect(json).toMatchObject({ scope: 'global', max: 3 });
  });

  it('lists the tasks of two projects with their projects', async () => {
    const box = globalBox();
    const lib = join(dirname(box.repo), 'lib');
    copyTemplateRepo(lib, PIPELINE_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    await aip(box, 'repo', 'add', box.repo, '--slug', 'app');
    await aip(box, 'repo', 'add', lib, '--slug', 'lib');
    await aip(box, 'queue', 'add', 'feature', '--task', 'task A', '--repo', box.repo);
    await aip(box, 'queue', 'add', 'feature', '--task', 'task B', '--repo', lib);
    const list = await aip(box, 'queue', 'list');
    const lines = list.stdout.split('\n');
    expect(lines.find((line) => line.includes('task A'))).toContain('[app]');
    expect(lines.find((line) => line.includes('task B'))).toContain('[lib]');
  });

  it('does not warn about --repo when a task is added, edited, moved or removed', async () => {
    const box = globalBox();
    const added = await aip(box, 'queue', 'add', 'feature', '--task', 'x', '--repo', box.repo);
    expect(added.code).toBe(0);
    expect(added.stderr).not.toContain('--repo is ignored');
    const { items } = JSON.parse((await aip(box, 'queue', 'list', '--json')).stdout) as {
      items: { id: string }[];
    };
    const id = items[0]!.id;
    const moved = await aip(box, 'queue', 'move', id, '1', '--repo', box.repo);
    expect(moved.code).toBe(0);
    expect(moved.stderr).not.toContain('--repo is ignored');
    const removed = await aip(box, 'queue', 'remove', id, '--repo', box.repo);
    expect(removed.code).toBe(0);
    expect(removed.stderr).not.toContain('--repo is ignored');
  });

  it('warns that --repo is ignored when it is passed', async () => {
    const box = globalBox();
    const start = await aip(box, 'queue', 'start', '--repo', box.repo);
    expect(start.code).toBe(0);
    expect(start.stderr).toContain('queue scope is global: --repo is ignored');
    const quiet = await aip(box, 'queue', 'pause');
    expect(quiet.stderr).not.toContain('--repo is ignored');
  });

  it('keeps the project mode without a warning', async () => {
    const box = sandbox();
    const list = await aip(box, 'queue', 'list', '--repo', box.repo);
    expect(list.stdout).toContain('Queue: stopped');
    expect(list.stderr).not.toContain('--repo is ignored');
  });
});
