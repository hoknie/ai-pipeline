import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  commitEdit,
  editorView,
  planSettings,
  revisionOf,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { settingFieldOf } from '../../../src/feature/swarm-edit/types/index.ts';
import {
  configPaths,
  loadNetworkSettings,
} from '../../../src/feature/swarm-config/services/index.ts';
import { type ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-network-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const find = (view: ReturnType<typeof editorView>, path: string) =>
  view.settings.find((setting) => setting.path === path);

describe('network settings in the editor', () => {
  it('writes network.* to the global file and the daemon reads it', () => {
    const paths = setup();
    const plan = planSettings(paths, {
      values: {
        'network.enabled': true,
        'network.interfaces': ['wt0'],
        'network.interval': 10,
        'network.proxy': 'http://127.0.0.1:3128',
      },
      revision: null,
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdit(plan);
    expect(loadNetworkSettings(paths)).toMatchObject({
      enabled: true,
      interfaces: ['wt0'],
      interval: 10,
      proxy: 'http://127.0.0.1:3128',
    });
  });

  it('refuses the project level', () => {
    const plan = planSettings(setup(), {
      values: { 'network.enabled': true },
      revision: null,
      level: 'project',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.network.enabled' }],
    });
  });

  it('refuses values out of range and a wrong target', () => {
    const paths = setup();
    const cases: Record<string, number | string | string[]>[] = [
      { 'network.interval': 4 },
      { 'network.timeout': 61 },
      { 'network.targets': ['api.anthropic.com'] },
      { 'network.proxy': 'socks5://x:1' },
    ];
    for (const values of cases) {
      expect(planSettings(paths, { values, revision: null })).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('catalogs the fields as global only', () => {
    expect(settingFieldOf('network.interval')).toMatchObject({
      kind: 'integer',
      range: [5, 3600],
      globalOnly: true,
    });
    expect(settingFieldOf('network.targets')).toMatchObject({ kind: 'strings' });
  });

  it('shows the defaults and the written values, without the password of the proxy', () => {
    const paths = setup();
    expect(find(editorView(paths), 'network.targets')?.value).toEqual([
      'https://api.anthropic.com',
    ]);
    expect(find(editorView(paths), 'network.enabled')?.value).toBe(false);
    const text = 'network:\n  enabled: true\n  proxy: http://user:secret@proxy.local:3128\n';
    write(join(paths.global.directory, 'settings.yaml'), text);
    const view = editorView(paths);
    expect(find(view, 'network.proxy')?.value).toBe('http://proxy.local:3128');
    expect(find(view, 'network.proxy')?.written.global).toBe('http://proxy.local:3128');
    expect(find(view, 'network.proxy')?.credentials).toBe(true);
    expect(find(view, 'network.targets')?.credentials).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('user:');
    expect(revisionOf(readFileSync(join(paths.global.directory, 'settings.yaml'), 'utf8'))).toBe(
      view.settingsFiles.global.revision,
    );
  });
});
