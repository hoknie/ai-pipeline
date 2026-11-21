import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import type { ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';
import {
  planEdit,
  planSettings,
  providerReferences,
  revisionOf,
  sharedProviderUsage,
} from '../../../src/feature/swarm-edit/services/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-default-provider-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const ZAI = 'name: Z.ai\naccess:\n  - { kind: cli, runtime: opencode, model_prefix: zai }\n';
const CLAUDE = 'name: Anthropic\naccess: [{ kind: cli, runtime: claude }]\n';

describe('the default_provider setting', () => {
  it('is written at the shared level and removed with null', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'providers', 'zai.yaml'), ZAI);
    const set = planSettings(paths, {
      values: { default_provider: 'zai' },
      revision: null,
      level: 'global',
    });
    if (!set.ok) throw new Error(JSON.stringify(set));
    expect(set.text).toContain('default_provider: zai');
    write(set.file, set.text!);
    const cleared = planSettings(paths, {
      values: { default_provider: null },
      revision: set.revision,
      level: 'global',
    });
    if (!cleared.ok) throw new Error(JSON.stringify(cleared));
    expect(cleared.text).not.toContain('default_provider');
  });

  it('is written at the project level for a project provider', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'providers', 'zai.yaml'), ZAI);
    const plan = planSettings(paths, {
      values: { default_provider: 'zai' },
      revision: null,
      level: 'project',
    });
    expect(plan.ok).toBe(true);
  });

  it('refuses an unknown provider and an empty value', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'providers', 'zai.yaml'), ZAI);
    const unknown = planSettings(paths, {
      values: { default_provider: 'nope' },
      revision: null,
      level: 'global',
    });
    if (unknown.ok || unknown.reason !== 'invalid') throw new Error('expected a refusal');
    expect(unknown.errors.map((error) => error.path)).toContain('swarm.default_provider');
    const empty = planSettings(paths, {
      values: { default_provider: '' },
      revision: null,
      level: 'global',
    });
    if (empty.ok || empty.reason !== 'invalid') throw new Error('expected a refusal');
    expect(empty.errors[0]?.path).toBe('swarm.default_provider');
  });

  it('refuses a shared value that names a project provider', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'providers', 'local.yaml'), ZAI);
    const plan = planSettings(paths, {
      values: { default_provider: 'local' },
      revision: null,
      level: 'global',
    });
    expect(plan.ok).toBe(false);
  });
});

describe('deleting the default provider', () => {
  it('is refused with the setting as the reference', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'providers', 'zai.yaml'), ZAI);
    write(join(paths.project.directory, 'providers', 'anthropic.yaml'), CLAUDE);
    write(join(paths.project.directory, 'settings.yaml'), 'default_provider: zai\n');
    const file = join(paths.project.directory, 'providers', 'zai.yaml');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'zai',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
      level: 'project',
    });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected a refusal');
    expect(plan.references).toEqual([{ setting: 'default_provider' }]);
  });

  it('is allowed for another provider', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'providers', 'zai.yaml'), ZAI);
    write(join(paths.project.directory, 'providers', 'anthropic.yaml'), CLAUDE);
    write(join(paths.project.directory, 'settings.yaml'), 'default_provider: zai\n');
    const file = join(paths.project.directory, 'providers', 'anthropic.yaml');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'anthropic',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
      level: 'project',
    });
    expect(plan.ok).toBe(true);
  });

  it('finds the setting in the tree and in the repositories that use the shared provider', () => {
    expect(providerReferences({ swarm: { default_provider: 'zai' } }, 'zai')).toEqual([
      { setting: 'default_provider' },
    ]);
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'providers', 'zai.yaml'), ZAI);
    write(join(paths.global.directory, 'settings.yaml'), 'default_provider: zai\n');
    expect(
      sharedProviderUsage(
        paths,
        [{ repository: '/a', paths: { global: paths.global, project: paths.project } }],
        'zai',
      ),
    ).toEqual([{ setting: 'default_provider', repository: '/a' }]);
  });
});
