import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  editorView,
  planSettings,
  commitEdit,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';

it('shows runtime setting fields and their defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-runtimes-'));
  const settings = editorView(
    configPaths(join(root, 'repo'), join(root, 'xdg'), undefined),
  ).settings;
  const find = (path: string) => settings.find((entry) => entry.path === path);
  expect(find('opencode.mcp')).toMatchObject({
    value: 'inherit',
    kind: 'choice',
    globalOnly: false,
  });
  expect(find('agy.mcp')).toMatchObject({ value: 'isolated', kind: 'choice', globalOnly: false });
  for (const name of ['claude', 'opencode', 'agy']) {
    expect(find(`${name}.overrides`)).toMatchObject({ value: {}, kind: 'json', globalOnly: false });
  }
});

it('writes JSON objects as whole nodes and rejects incorrect kinds', () => {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-json-'));
  const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
  const first = planSettings(paths, {
    values: { 'opencode.overrides': { provider: { local: { npm: 'x' } }, old: 1 } },
    level: 'project',
    revision: null,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  commitEdit(first);
  const second = planSettings(paths, {
    values: { 'opencode.overrides': { provider: { other: true } } },
    level: 'project',
    revision: first.revision,
  });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.text).not.toContain('old');
  expect(second.text).not.toContain('local');
  commitEdit(second);
  const removed = planSettings(paths, {
    values: { 'opencode.overrides': {} },
    level: 'project',
    revision: second.revision,
  });
  expect(removed.ok && removed.text).not.toContain('overrides');
  expect(
    planSettings(paths, { values: { max: { x: 1 } }, level: 'project', revision: second.revision }),
  ).toMatchObject({ ok: false, reason: 'invalid' });
  expect(
    planSettings(paths, {
      values: { 'agy.overrides': 'bad' },
      level: 'project',
      revision: second.revision,
    }),
  ).toMatchObject({ ok: false, reason: 'invalid' });
});
