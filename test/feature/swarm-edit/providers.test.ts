import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import type { ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';
import {
  editorView,
  entryFile,
  planEdit,
  planSettings,
  providerReferences,
  revisionOf,
  sharedProviderUsage,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { KIND_DIRECTORY } from '../../../src/feature/swarm-edit/types/index.ts';

function temporaryPaths(): ConfigPaths {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-providers-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const ZAI = 'name: Z.ai\naccess:\n  - { kind: cli, runtime: opencode, model_prefix: zai }\n';

const THINKING =
  'name: Thinking\nmode: by_provider\nruntimes:\n  - { provider: anthropic, runtime: claude }\n  - { provider: zai, runtime: opencode, model: zai/glm-5.3 }\n';

describe('provider entries', () => {
  it('live in the providers directory of a level', () => {
    const paths = temporaryPaths();
    expect(KIND_DIRECTORY.provider).toBe('providers');
    expect(entryFile(paths, 'provider', 'zai', 'global')).toBe(
      join(paths.global.directory, 'providers', 'zai.yaml'),
    );
  });

  it('are written at the shared level with a new revision', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'zai',
      value: {
        name: 'Z.ai',
        access: [{ kind: 'cli', runtime: 'opencode', model_prefix: 'zai' }],
      },
      revision: null,
      level: 'global',
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    expect(plan.file).toBe(join(paths.global.directory, 'providers', 'zai.yaml'));
    expect(plan.text).toContain('model_prefix: zai');
    expect(plan.revision).toBe(revisionOf(plan.text ?? undefined));
  });

  it('refuse a command in a project provider and write nothing', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'zai',
      value: {
        name: 'Z.ai',
        access: [{ kind: 'cli', runtime: 'opencode', command: '/opt/opencode' }],
      },
      revision: null,
      level: 'project',
    });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected a refusal');
    expect(plan.errors.map((error) => error.path)).toContain(
      'swarm.providers.zai.access[0].command',
    );
  });

  it('refuse a key as a value: only the name of the variable fits', () => {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'corp',
      value: {
        name: 'Corp',
        access: [
          {
            kind: 'cli',
            runtime: 'codex',
            endpoint: { base_url: 'https://llm.example/v1', key_env: 'sk-secret value' },
          },
        ],
      },
      revision: null,
      level: 'project',
    });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected a refusal');
    expect(plan.errors.map((error) => error.path)).toContain(
      'swarm.providers.corp.access[0].endpoint.key_env',
    );
  });

  it('are listed by the editor with both levels and the effective provider', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'providers', 'zai.yaml'), ZAI);
    write(join(paths.project.directory, 'providers', 'zai.yaml'), ZAI.replace('Z.ai', 'Z.ai own'));
    write(
      join(paths.project.directory, 'providers', 'own.yaml'),
      'name: Own\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    const view = editorView(paths);
    expect(view.providers.map((provider) => [provider.slug, provider.level])).toEqual([
      ['own', 'project'],
      ['zai', 'project_over_global'],
    ]);
    const zai = view.providers.find((provider) => provider.slug === 'zai')!;
    expect(zai.sources.global?.raw).toMatchObject({ name: 'Z.ai' });
    expect(zai.effective).toMatchObject({ name: 'Z.ai own', level: 'project' });
  });
});

describe('deleting a provider', () => {
  function setup(): ConfigPaths {
    const paths = temporaryPaths();
    write(join(paths.project.directory, 'settings.yaml'), 'max: 3\n');
    write(
      join(paths.project.directory, 'providers', 'anthropic.yaml'),
      'name: Anthropic\naccess: [{ kind: cli, runtime: claude }]\n',
    );
    write(join(paths.project.directory, 'providers', 'zai.yaml'), ZAI);
    write(join(paths.project.directory, 'chains', 'thinking.yaml'), THINKING);
    return paths;
  }

  it('is refused while an item of a chain names it, listing the item', () => {
    const paths = setup();
    const file = join(paths.project.directory, 'providers', 'zai.yaml');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'zai',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
      level: 'project',
    });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected a refusal');
    expect(plan.references).toEqual([{ chain: 'thinking', item: 1 }]);
  });

  it('is allowed when a provider nobody names goes', () => {
    const paths = setup();
    write(join(paths.project.directory, 'providers', 'spare.yaml'), ZAI);
    const file = join(paths.project.directory, 'providers', 'spare.yaml');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'spare',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
      level: 'project',
    });
    expect(plan.ok).toBe(true);
  });

  it('is allowed for a project override: the shared provider stays', () => {
    const paths = setup();
    write(join(paths.global.directory, 'providers', 'zai.yaml'), ZAI);
    const file = join(paths.project.directory, 'providers', 'zai.yaml');
    const plan = planEdit(paths, {
      kind: 'provider',
      id: 'zai',
      value: null,
      revision: revisionOf(readFileSync(file, 'utf8')),
      level: 'project',
    });
    expect(plan.ok).toBe(true);
  });

  it('finds the references in the tree, and in the repositories that use a shared provider', () => {
    expect(
      providerReferences(
        { swarm: { chains: { a: { runtimes: [{ runtime: 'claude' }, { provider: 'zai' }] } } } },
        'zai',
      ),
    ).toEqual([{ chain: 'a', item: 1 }]);
    const paths = temporaryPaths();
    const other = temporaryPaths();
    write(join(paths.global.directory, 'providers', 'zai.yaml'), ZAI);
    write(join(other.project.directory, 'chains', 'thinking.yaml'), THINKING);
    write(join(other.project.directory, 'providers', 'zai.yaml'), ZAI);
    const used = sharedProviderUsage(
      paths,
      [
        { repository: '/a', paths: { global: paths.global, project: other.project } },
        { repository: '/b', paths: { global: paths.global, project: paths.project } },
      ],
      'zai',
    );
    // /a defines its own zai, /b has no chain: nothing names the shared one
    expect(used).toEqual([]);
    write(join(paths.project.directory, 'chains', 'thinking.yaml'), THINKING);
    expect(
      sharedProviderUsage(
        paths,
        [{ repository: '/b', paths: { global: paths.global, project: paths.project } }],
        'zai',
      ),
    ).toEqual([{ chain: 'thinking', item: 1, repository: '/b' }]);
  });
});

describe('roles in the editor', () => {
  const settings = (paths: ConfigPaths, level: 'project' | 'global', value: unknown) =>
    planSettings(paths, {
      values: { roles: value as Record<string, unknown> | null },
      revision: null,
      level,
    });

  it('are written as an object at the shared level, in the order given', () => {
    const paths = temporaryPaths();
    const plan = settings(paths, 'global', {
      think: { name: 'Думать' },
      light: { name: 'Лёгкое' },
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    expect(plan.text!.indexOf('think')).toBeLessThan(plan.text!.indexOf('light'));
    write(plan.file, plan.text!);
    const roles = editorView(paths).settings.find((setting) => setting.path === 'roles');
    expect(roles?.kind).toBe('roles');
    expect(roles?.value).toEqual({ think: { name: 'Думать' }, light: { name: 'Лёгкое' } });
  });

  it('are refused when a value is not an object', () => {
    const paths = temporaryPaths();
    const plan = settings(paths, 'global', ['think']);
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected a refusal');
    expect(plan.errors[0]?.path).toBe('swarm.roles');
  });

  it('add a role at the project level, after the shared ones', () => {
    const paths = temporaryPaths();
    write(join(paths.global.directory, 'settings.yaml'), 'roles:\n  think: { name: Think }\n');
    const plan = settings(paths, 'project', { review: { name: 'Ревью' } });
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    write(plan.file, plan.text!);
    const roles = editorView(paths).settings.find((setting) => setting.path === 'roles');
    expect(Object.keys(roles!.value as object)).toEqual(['think', 'review']);
  });

  it('cannot lose a role a provider has a model for, and the file stays', () => {
    const paths = temporaryPaths();
    const file = join(paths.global.directory, 'settings.yaml');
    const text = 'roles:\n  think: { name: Think }\n  light: { name: Light }\n';
    write(file, text);
    write(
      join(paths.global.directory, 'providers', 'zai.yaml'),
      `${ZAI}models: { light: GLM-5.3-Flash }\n`,
    );
    const plan = planSettings(paths, {
      values: { roles: { think: { name: 'Think' } } },
      revision: revisionOf(text),
      level: 'global',
    });
    if (plan.ok || plan.reason !== 'invalid') throw new Error('expected a refusal');
    expect(plan.errors.map((error) => error.path)).toContain('swarm.providers.zai.models.light');
    expect(readFileSync(file, 'utf8')).toBe(text);
  });
});
