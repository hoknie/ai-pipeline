import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadRuntimeSettings,
  configPaths,
} from '../../../src/feature/swarm-config/services/index.ts';
import { settingFieldOf } from '../../../src/feature/swarm-edit/types/index.ts';
import {
  commitEdit,
  editorView,
  planSettings,
  settingsFile,
} from '../../../src/feature/swarm-edit/services/index.ts';

const NEW = ['codex', 'kilo', 'cline', 'copilot'] as const;

function paths() {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-proxy-'));
  mkdirSync(join(root, 'xdg', 'aip'), { recursive: true });
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

describe('the settings of the four CLIs in the editor', () => {
  it.each(NEW)('shows %s with defaults and a global-only card', (name) => {
    const view = editorView(paths());
    const find = (path: string) => view.settings.find((entry) => entry.path === path);
    expect(find(`runtimes.${name}.command`)).toMatchObject({ value: name, globalOnly: true });
    expect(find(`runtimes.${name}.enabled`)).toMatchObject({ value: false, globalOnly: true });
    expect(find(`runtimes.${name}.args`)?.value).toEqual([]);
    expect(find(`runtimes.${name}.env`)?.value).toEqual([]);
    expect(settingFieldOf(`runtimes.${name}.env.KEY`)).toMatchObject({ globalOnly: true });
    expect(settingFieldOf(`runtimes.${name}.env.1BAD`)).toBeUndefined();
    expect(find('defaults.runtime')).toMatchObject({ kind: 'choice' });
  });

  it('writes the switch and a variable and gives only the names back, never the value', () => {
    const where = paths();
    const plan = planSettings(where, {
      values: {
        'runtimes.copilot.enabled': true,
        'runtimes.copilot.env.COPILOT_PROVIDER_API_KEY': 'sk-very-secret',
        'runtimes.codex.args': ['--x'],
      },
      level: 'global',
      revision: null,
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    commitEdit(plan);
    expect(readFileSync(settingsFile(where, 'global'), 'utf8')).toContain('sk-very-secret');
    const settings = loadRuntimeSettings(where);
    expect(settings.copilot).toMatchObject({
      enabled: true,
      env: { COPILOT_PROVIDER_API_KEY: 'sk-very-secret' },
    });
    const view = editorView(where);
    expect(view.settings.find((entry) => entry.path === 'runtimes.copilot.env')?.value).toEqual([
      'COPILOT_PROVIDER_API_KEY',
    ]);
    expect(JSON.stringify(view)).not.toContain('sk-very-secret');
  });

  it('does not accept the settings of a runtime that is not offered', () => {
    expect(() =>
      planSettings(paths(), {
        values: { 'runtimes.cursor.enabled': true },
        level: 'global',
        revision: null,
      }),
    ).toThrow('cannot be written');
  });
});
