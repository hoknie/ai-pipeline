import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';
import {
  chainReferences,
  editorView,
  entryFile,
  planEdit,
  revisionOf,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-chains-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('chains in editor', () => {
  it('lists chains in editorView with levels and revisions', () => {
    const paths = temporaryPaths();
    write(
      join(paths.global.directory, 'chains', 'shared.yaml'),
      'name: Общая\nmode: on_error\nruntimes:\n  - runtime: claude\n',
    );
    write(
      join(paths.project.directory, 'chains', 'shared.yaml'),
      'name: Переопределенная\nmode: random\nruntimes:\n  - runtime: opencode\n',
    );
    write(
      join(paths.project.directory, 'chains', 'own.yaml'),
      'name: Собственная\nmode: round_robin\nruntimes:\n  - runtime: agy\n',
    );

    const view = editorView(paths);
    expect(view.chains).toHaveLength(2);

    const shared = view.chains.find((c) => c.slug === 'shared');
    expect(shared?.level).toBe('project_over_global');
    expect(shared?.raw).toMatchObject({ name: 'Переопределенная', mode: 'random' });
    expect(shared?.sources.global?.raw).toMatchObject({ name: 'Общая' });
    expect(shared?.sources.project?.raw).toMatchObject({ name: 'Переопределенная' });

    const own = view.chains.find((c) => c.slug === 'own');
    expect(own?.level).toBe('project');
    expect(own?.raw).toMatchObject({ name: 'Собственная', mode: 'round_robin' });
  });

  it('plans creation, update with revision and deletion of a chain', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');

    // 1. Create a chain
    const create = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: {
        name: 'Основная',
        mode: 'on_error',
        runtimes: [{ runtime: 'claude' }],
      },
      revision: null,
      level: 'project',
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    write(create.file, create.text!);

    // 2. Conflict when revision is wrong
    const conflict = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: { name: 'Другая' },
      revision: 'wrong-revision',
      level: 'project',
    });
    expect(conflict).toMatchObject({ ok: false, reason: 'conflict' });

    // 3. Update with correct revision
    const currentRev = revisionOf(create.text!);
    const update = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: {
        name: 'Обновленная',
        mode: 'random',
        runtimes: [{ runtime: 'opencode' }],
      },
      revision: currentRev,
      level: 'project',
    });
    expect(update.ok).toBe(true);
    if (!update.ok) return;
    write(update.file, update.text!);

    // 4. Delete the chain
    const deleteRev = revisionOf(update.text!);
    const del = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: null,
      revision: deleteRev,
      level: 'project',
    });
    expect(del.ok).toBe(true);
  });

  it('refuses to delete a chain that a specialist references', () => {
    const paths = temporaryPaths();
    write(
      join(paths.project.directory, 'chains', 'main.yaml'),
      'name: Основная\nmode: on_error\nruntimes:\n  - runtime: claude\n',
    );
    write(
      join(paths.project.directory, 'specialists', 'coder.yaml'),
      'name: Кодировщик\nruntime_chain: main\n',
    );

    const file = entryFile(paths, 'chain', 'main', 'project');
    const del = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: null,
      revision: revisionOf('name: Основная\nmode: on_error\nruntimes:\n  - runtime: claude\n'),
      level: 'project',
    });

    expect(del).toMatchObject({
      ok: false,
      reason: 'invalid',
      references: [{ specialist: 'coder' }],
    });
  });

  it('finds specialist references to chain via chainReferences', () => {
    const tree = {
      swarm: {
        specialists: {
          coder: { name: 'Кодировщик', runtime_chain: 'fallback' },
          reviewer: { name: 'Ревьюер', runtime: 'claude' },
        },
      },
    };
    expect(chainReferences(tree, 'fallback')).toEqual([{ specialist: 'coder' }]);
    expect(chainReferences(tree, 'missing')).toEqual([]);
  });
});
