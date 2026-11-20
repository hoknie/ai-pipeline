import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  commitEdit,
  editorView,
  planSettings,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { isObjectSetting } from '../../../src/feature/swarm-edit/types/index.ts';
import {
  configPaths,
  loadQueueSettings,
} from '../../../src/feature/swarm-config/services/index.ts';
import { type ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-pools-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function globalFile(paths: ConfigPaths): string {
  return join(paths.global.directory, 'settings.yaml');
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const POOLS = {
  claude: { max: 2, members: ['claude'] },
  glm: { max: 1, members: ['opencode:zai/*'] },
};

const find = (view: ReturnType<typeof editorView>, path: string) =>
  view.settings.find((setting) => setting.path === path);

describe('queue pools in the editor', () => {
  it('tells the fields that take an object', () => {
    expect(isObjectSetting('queue.pools')).toBe(true);
    expect(isObjectSetting('claude.overrides')).toBe(true);
    expect(isObjectSetting('queue.max')).toBe(false);
    expect(isObjectSetting('nope')).toBe(false);
  });

  it('writes the pools and the default pool together, keeping queue.max and comments', () => {
    const paths = setup();
    write(globalFile(paths), '# my queue\nqueue:\n  max: 4 # machine\n');
    const first = editorView(paths);
    const plan = planSettings(paths, {
      values: { 'queue.pools': POOLS, 'queue.default_pool.max': 3 },
      revision: first.settingsFiles.global.revision,
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdit(plan);
    const text = readFileSync(globalFile(paths), 'utf8');
    expect(text).toContain('# my queue');
    expect(text).toContain('# machine');
    const queue = loadQueueSettings(paths);
    expect(queue.max).toBe(4);
    expect(queue.pools.map((pool) => pool.name)).toEqual(['claude', 'glm']);
    expect(queue.defaultPool).toEqual({ max: 3 });
  });

  it('refuses pools without the default pool', () => {
    const paths = setup();
    const plan = planSettings(paths, { values: { 'queue.pools': POOLS }, revision: null });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.queue.default_pool' }],
    });
  });

  it('refuses a selector that two pools share and names the pool', () => {
    const paths = setup();
    const plan = planSettings(paths, {
      values: {
        'queue.pools': {
          a: { max: 1, members: ['claude'] },
          b: { max: 1, members: ['claude'] },
        },
        'queue.default_pool.max': 1,
      },
      revision: null,
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.queue.pools.b.members[0]' }],
    });
  });

  it('refuses a list and a pool that is not an object', () => {
    const paths = setup();
    expect(
      planSettings(paths, { values: { 'queue.pools': ['a'] as never }, revision: null }),
    ).toMatchObject({
      ok: false,
      errors: [{ path: 'swarm.queue.pools', message: 'must be an object' }],
    });
    expect(
      planSettings(paths, { values: { 'queue.pools': { a: 1 } as never }, revision: null }),
    ).toMatchObject({
      ok: false,
      errors: [{ path: 'swarm.queue.pools.a' }],
    });
  });

  it('removes the pools and the default pool with null and keeps queue.max', () => {
    const paths = setup();
    write(globalFile(paths), 'queue:\n  max: 6\n');
    const added = planSettings(paths, {
      values: { 'queue.pools': POOLS, 'queue.default_pool.max': 2 },
      revision: editorView(paths).settingsFiles.global.revision,
    });
    if (!added.ok) throw new Error(JSON.stringify(added));
    commitEdit(added);
    const removed = planSettings(paths, {
      values: { 'queue.pools': null, 'queue.default_pool.max': null },
      revision: editorView(paths).settingsFiles.global.revision,
    });
    if (!removed.ok) throw new Error(JSON.stringify(removed));
    commitEdit(removed);
    const queue = loadQueueSettings(paths);
    expect(queue).toMatchObject({ max: 6, pools: [], defaultPool: null });
    const text = readFileSync(globalFile(paths), 'utf8');
    expect(text).not.toContain('pools');
    expect(text).not.toContain('default_pool');
  });

  it('removes the emptied queue section with the pools', () => {
    const paths = setup();
    write(
      globalFile(paths),
      'queue:\n  pools:\n    claude:\n      max: 2\n      members: [claude]\n  default_pool:\n    max: 3\nweb:\n  port: 8000\n',
    );
    const plan = planSettings(paths, {
      values: { 'queue.pools': null, 'queue.default_pool.max': null },
      revision: editorView(paths).settingsFiles.global.revision,
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    expect(plan.text).not.toContain('queue');
    expect(plan.text).toContain('web');
  });

  it('treats an empty object as removal', () => {
    const paths = setup();
    write(globalFile(paths), 'queue:\n  max: 6\n');
    const plan = planSettings(paths, {
      values: { 'queue.pools': {}, 'queue.default_pool.max': null },
      revision: editorView(paths).settingsFiles.global.revision,
    });
    expect(plan.ok).toBe(true);
  });

  it('refuses the project level', () => {
    const plan = planSettings(setup(), {
      values: { 'queue.pools': POOLS, 'queue.default_pool.max': 1 },
      revision: null,
      level: 'project',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.queue.pools' }, { path: 'swarm.queue.default_pool.max' }],
    });
  });

  it('shows the pools of the file and the defaults without them', () => {
    const paths = setup();
    const empty = editorView(paths);
    expect(find(empty, 'queue.pools')).toMatchObject({
      kind: 'pools',
      value: {},
      defaultValue: {},
      globalOnly: true,
    });
    expect(find(empty, 'queue.pools')?.written).toEqual({});
    expect(find(empty, 'queue.default_pool.max')).toMatchObject({
      value: null,
      defaultValue: null,
    });
  });

  it('shows the pools of the file with their source', () => {
    const paths = setup();
    write(
      globalFile(paths),
      'queue:\n  pools:\n    claude:\n      max: 2\n      members: [claude]\n  default_pool:\n    max: 3\n',
    );
    const view = editorView(paths);
    expect(find(view, 'queue.pools')).toMatchObject({
      value: { claude: { max: 2, members: ['claude'] } },
      written: { global: { claude: { max: 2, members: ['claude'] } } },
    });
    expect(find(view, 'queue.default_pool.max')).toMatchObject({
      value: 3,
      written: { global: 3 },
    });
  });

  it('shows the defaults and the text of the file when the queue section is wrong', () => {
    const paths = setup();
    write(
      globalFile(paths),
      'queue:\n  pools:\n    claude:\n      max: 2\n      members: [claude]\n',
    );
    const pools = find(editorView(paths), 'queue.pools');
    expect(pools?.value).toEqual({});
    expect(pools?.written.global).toEqual({ claude: { max: 2, members: ['claude'] } });
  });
});
