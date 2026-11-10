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

  it('preserves provider-qualified model IDs when updating a chain', () => {
    const paths = temporaryPaths();
    const initial =
      'name: Main\nmode: on_error\nruntimes:\n  - runtime: opencode\n    model: openai/gpt-custom\n';
    const file = join(paths.project.directory, 'chains', 'main.yaml');
    write(file, initial);
    const plan = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: {
        name: 'Main updated',
        mode: 'on_error',
        runtimes: [{ runtime: 'opencode', model: 'other/gpt-custom' }],
      },
      revision: revisionOf(initial),
      level: 'project',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.text).toContain('model: other/gpt-custom');
  });

  it('keeps model and variant attached to runtime elements when reordered', () => {
    const paths = temporaryPaths();
    const initial =
      'name: Main\nmode: on_error\nruntimes:\n  - runtime: opencode\n    model: alpha/gpt\n    variant: fast\n  - runtime: opencode\n    model: beta/gpt\n    variant: deep\n';
    const file = join(paths.project.directory, 'chains', 'main.yaml');
    write(file, initial);
    const plan = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: {
        name: 'Main',
        mode: 'on_error',
        runtimes: [
          { runtime: 'opencode', model: 'beta/gpt', variant: 'deep' },
          { runtime: 'opencode', model: 'alpha/gpt', variant: 'fast' },
        ],
      },
      revision: revisionOf(initial),
      level: 'project',
    });
    if (!plan.ok) throw new Error('expected valid reordered chain');
    write(plan.file, plan.text!);
    const reopened = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: {
        name: 'Main',
        mode: 'on_error',
        runtimes: [
          { runtime: 'opencode', model: 'beta/gpt', variant: 'deep' },
          { runtime: 'opencode', model: 'alpha/gpt', variant: 'fast' },
        ],
      },
      revision: revisionOf(plan.text!),
      level: 'project',
    });
    if (!reopened.ok) throw new Error('expected reordered chain to reopen');
    expect(reopened.text).toContain('model: beta/gpt');
    expect(reopened.text).toContain('variant: deep');
    expect(reopened.text!.indexOf('model: beta/gpt')).toBeLessThan(
      reopened.text!.indexOf('model: alpha/gpt'),
    );
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

  it('rejects a new short OpenCode model in chain runtime and saves full IDs across levels', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');

    // Rejecting a new short model in a chain element
    const invalid = planEdit(paths, {
      kind: 'chain',
      id: 'main',
      value: {
        name: 'Main',
        mode: 'on_error',
        runtimes: [{ runtime: 'opencode', model: 'short-model' }],
      },
      revision: null,
      level: 'project',
    });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
    if (invalid.ok || invalid.reason !== 'invalid') throw new Error('expected invalid chain');
    expect(invalid.errors).toContainEqual({
      file: join(paths.project.directory, 'chains', 'main.yaml'),
      path: 'swarm.chains.main.runtimes[0].model',
      message: expect.stringContaining('short-model'),
    });

    // Valid chain at global level
    const globalChain = planEdit(paths, {
      kind: 'chain',
      id: 'shared-chain',
      value: {
        name: 'Shared Chain',
        mode: 'on_error',
        runtimes: [{ runtime: 'opencode', model: 'provider/gpt-shared' }],
      },
      revision: null,
      level: 'global',
    });
    expect(globalChain.ok).toBe(true);
    if (!globalChain.ok) throw new Error('expected valid global chain');
    write(globalChain.file, globalChain.text!);

    // Valid chain at project level
    const projectChain = planEdit(paths, {
      kind: 'chain',
      id: 'project-chain',
      value: {
        name: 'Project Chain',
        mode: 'on_error',
        runtimes: [{ runtime: 'opencode', model: 'provider/gpt-project' }],
      },
      revision: null,
      level: 'project',
    });
    expect(projectChain.ok).toBe(true);
    if (!projectChain.ok) throw new Error('expected valid project chain');
    write(projectChain.file, projectChain.text!);

    const view = editorView(paths);
    const shared = view.chains.find((c) => c.slug === 'shared-chain');
    const project = view.chains.find((c) => c.slug === 'project-chain');
    expect(shared?.raw).toMatchObject({
      runtimes: [{ model: 'provider/gpt-shared' }],
    });
    expect(project?.raw).toMatchObject({
      runtimes: [{ model: 'provider/gpt-project' }],
    });
  });
});
