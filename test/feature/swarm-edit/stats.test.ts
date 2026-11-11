import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  commitEdit,
  editorView,
  planSettings,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { settingFieldOf } from '../../../src/feature/swarm-edit/types/index.ts';
import {
  configPaths,
  loadStatsSettings,
} from '../../../src/feature/swarm-config/services/index.ts';
import { type ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-stats-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

describe('stats settings in the editor', () => {
  it('excludes a project: writes stats.* to the global file and the daemon reads it', () => {
    const paths = setup();
    const plan = planSettings(paths, {
      values: { 'stats.exclude': ['/work/app'], 'stats.show_cost': false },
      revision: null,
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdit(plan);
    expect(loadStatsSettings(paths)).toEqual({
      enabled: true,
      exclude: ['/work/app'],
      showCost: false,
    });
  });

  it('refuses the project level', () => {
    const plan = planSettings(setup(), {
      values: { 'stats.enabled': false },
      revision: null,
      level: 'project',
    });
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [{ path: 'swarm.stats.enabled' }],
    });
  });

  it('refuses an empty path in the list', () => {
    expect(
      planSettings(setup(), { values: { 'stats.exclude': [''] }, revision: null }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('catalogs the fields as global only and shows the defaults', () => {
    expect(settingFieldOf('stats.enabled')).toMatchObject({ kind: 'boolean', globalOnly: true });
    expect(settingFieldOf('stats.exclude')).toMatchObject({ kind: 'strings', globalOnly: true });
    const view = editorView(setup());
    const find = (path: string) => view.settings.find((setting) => setting.path === path);
    expect(find('stats.enabled')?.value).toBe(true);
    expect(find('stats.exclude')?.value).toEqual([]);
    expect(find('stats.show_cost')?.value).toBe(true);
  });
});
