import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import type { ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';
import {
  commitEdit,
  planEdit,
  revisionOf,
} from '../../../src/feature/swarm-edit/services/index.ts';

function setup(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-model-edit-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe('model IDs in the config editor', () => {
  it('preserves the full ID through a non-model edit and rejects new short IDs without writing', () => {
    const paths = setup();
    const file = join(paths.project.directory, 'specialists', 'coder.yaml');
    const yaml = 'name: Coder\nruntime: opencode\nmodel: MyProvider/team/GPT-Custom\n';
    write(file, yaml);

    const invalid = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Coder', runtime: 'opencode', model: 'GPT-Custom' },
      revision: revisionOf(yaml),
    });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
    if (invalid.ok || invalid.reason !== 'invalid') throw new Error('expected validation error');
    expect(invalid.errors).toContainEqual({
      file,
      path: 'swarm.specialists.coder.model',
      message: expect.stringContaining('GPT-Custom'),
    });
    expect(readFileSync(file, 'utf8')).toBe(yaml);

    const valid = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Coder changed', runtime: 'opencode', model: 'MyProvider/team/GPT-Custom' },
      revision: revisionOf(yaml),
    });
    if (!valid.ok) throw new Error('expected valid model edit');
    commitEdit(valid);
    const committed = readFileSync(file, 'utf8');
    expect(committed).toContain('model: MyProvider/team/GPT-Custom');
    expect(revisionOf(committed)).not.toBe(revisionOf(yaml));
    const reopened = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Coder changed', runtime: 'opencode', model: 'MyProvider/team/GPT-Custom' },
      revision: revisionOf(committed),
    });
    expect(reopened.ok).toBe(true);
  });

  it('writes and reads back full IDs at global and project levels independently', () => {
    const paths = setup();
    const globalFile = join(paths.global.directory, 'specialists', 'global-coder.yaml');
    const projectFile = join(paths.project.directory, 'specialists', 'project-coder.yaml');

    const globalPlan = planEdit(paths, {
      kind: 'specialist',
      id: 'global-coder',
      value: { name: 'Global Coder', runtime: 'opencode', model: 'openai/gpt-global' },
      revision: null,
      level: 'global',
    });
    expect(globalPlan.ok).toBe(true);
    if (!globalPlan.ok) throw new Error('expected global plan to succeed');
    commitEdit(globalPlan);
    const globalSaved = readFileSync(globalFile, 'utf8');
    expect(globalSaved).toContain('model: openai/gpt-global');

    const projectPlan = planEdit(paths, {
      kind: 'specialist',
      id: 'project-coder',
      value: { name: 'Project Coder', runtime: 'opencode', model: 'other/gpt-project' },
      revision: null,
      level: 'project',
    });
    expect(projectPlan.ok).toBe(true);
    if (!projectPlan.ok) throw new Error('expected project plan to succeed');
    commitEdit(projectPlan);
    const projectSaved = readFileSync(projectFile, 'utf8');
    expect(projectSaved).toContain('model: other/gpt-project');

    // Global file remains untouched by project write
    expect(readFileSync(globalFile, 'utf8')).toBe(globalSaved);
  });

  it('preserves YAML comments and allows unrelated edits with stale model errors or fixing them', () => {
    const paths = setup();
    const file = join(paths.project.directory, 'specialists', 'coder.yaml');
    const yamlWithComment =
      '# primary coder comment\nname: Coder\nruntime: opencode\nmodel: openai/gpt-prod\n';
    write(file, yamlWithComment);

    // Unrelated edit preserves comment and full model
    const editName = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Renamed Coder', runtime: 'opencode', model: 'openai/gpt-prod' },
      revision: revisionOf(yamlWithComment),
    });
    expect(editName.ok).toBe(true);
    if (!editName.ok) throw new Error('expected editName to succeed');
    commitEdit(editName);
    const afterName = readFileSync(file, 'utf8');
    expect(afterName).toContain('# primary coder comment');
    expect(afterName).toContain('model: openai/gpt-prod');

    // File with stale short model allows unrelated edit
    const staleYaml = 'name: Stale\nruntime: opencode\nmodel: gpt-old-short\n';
    write(file, staleYaml);
    const unrelated = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Stale Renamed', runtime: 'opencode', model: 'gpt-old-short' },
      revision: revisionOf(staleYaml),
    });
    expect(unrelated.ok).toBe(true);
    if (!unrelated.ok) throw new Error('expected unrelated edit to succeed');
    commitEdit(unrelated);

    // Fixing the old ID with a full ID succeeds with a new revision
    const fixing = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      value: { name: 'Stale Renamed', runtime: 'opencode', model: 'openai/gpt-repaired' },
      revision: revisionOf(readFileSync(file, 'utf8')),
    });
    expect(fixing.ok).toBe(true);
    if (!fixing.ok) throw new Error('expected fixing edit to succeed');
    commitEdit(fixing);
    const repaired = readFileSync(file, 'utf8');
    expect(repaired).toContain('model: openai/gpt-repaired');
  });

  it('copies a specialist under a new slug while preserving full model ID', () => {
    const paths = setup();
    const sourceFile = join(paths.project.directory, 'specialists', 'coder.yaml');
    const yaml = 'name: Coder\nruntime: opencode\nmodel: MyProvider/team/GPT-Custom\n';
    write(sourceFile, yaml);

    const copyPlan = planEdit(paths, {
      kind: 'specialist',
      id: 'coder-v2',
      value: { name: 'Coder Copy', runtime: 'opencode', model: 'MyProvider/team/GPT-Custom' },
      revision: null,
      level: 'project',
    });
    expect(copyPlan.ok).toBe(true);
    if (!copyPlan.ok) throw new Error('expected copyPlan to succeed');
    commitEdit(copyPlan);

    const newFile = join(paths.project.directory, 'specialists', 'coder-v2.yaml');
    expect(readFileSync(newFile, 'utf8')).toContain('model: MyProvider/team/GPT-Custom');
    expect(readFileSync(sourceFile, 'utf8')).toBe(yaml);
  });
});
