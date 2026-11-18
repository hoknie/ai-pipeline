import { describe, expect, it } from 'vitest';

import { matchesRuntime, runtimeRows } from '../src/features/settings/runtimes/runtimeRows.ts';
import { RUNTIME_KEYS } from '../src/shared/ui/forms/settings/settingFields.ts';
import { configView, settingsOf } from './fixtures.ts';

describe('RUNTIME_KEYS', () => {
  it('lists the runtimes in the order of their cards', () => {
    expect(RUNTIME_KEYS).toEqual([
      'claude',
      'opencode',
      'agy',
      'codex',
      'kilo',
      'cline',
      'copilot',
    ]);
  });
});

describe('runtimeRows', () => {
  const rowsOf = (overrides = {}) => runtimeRows(configView({ settings: settingsOf(overrides) }));

  it('builds a row per runtime with state, command, arguments and the count of variables', () => {
    const rows = rowsOf({
      'runtimes.claude.enabled': { path: 'runtimes.claude.enabled', value: true },
      'runtimes.agy.args': { path: 'runtimes.agy.args', value: ['--effort', 'high'] },
    });
    expect(rows.map((row) => row.key)).toEqual([...RUNTIME_KEYS]);
    expect(rows[0]).toEqual({
      key: 'claude',
      enabled: true,
      command: 'claude',
      args: [],
      envCount: 1,
    });
    expect(rows[1]).toMatchObject({ key: 'opencode', enabled: false, command: 'opencode' });
    expect(rows[2]?.args).toEqual(['--effort', 'high']);
  });

  it('keeps only the number of variables, never their names or values', () => {
    expect(JSON.stringify(rowsOf()[0])).not.toContain('ANTHROPIC_API_KEY');
  });

  it('skips a runtime that has no fields in the config', () => {
    const settings = settingsOf().filter((setting) => !setting.path.startsWith('runtimes.kilo.'));
    expect(runtimeRows(configView({ settings })).map((row) => row.key)).not.toContain('kilo');
  });
});

describe('matchesRuntime', () => {
  const titles: Record<string, string> = {
    claude: 'Claude',
    opencode: 'OpenCode',
    codex: 'Codex CLI',
    kilo: 'Kilo Code CLI',
    agy: 'Antigravity CLI (agy)',
  };
  const found = (query: string) =>
    runtimeRows(configView({ settings: settingsOf() }))
      .filter((row) => matchesRuntime(row, titles[row.key] ?? row.key, query))
      .map((row) => row.key);

  it('matches by title and key, by words and without case', () => {
    expect(found('code')).toEqual(['opencode', 'codex', 'kilo']);
    expect(found('CLI kilo')).toEqual(['kilo']);
    expect(found('')).toHaveLength(7);
    expect(found('nothing')).toEqual([]);
  });
});
