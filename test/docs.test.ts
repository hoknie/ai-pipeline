import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  configFromFiles,
  configPaths,
  findSpecialist,
  findWorkflow,
  loadWebSettings,
} from '../src/config/index.ts';

const root = join(import.meta.dirname, '..');

function dedent(block: string): string {
  const lines = block.split('\n');
  const width = Math.min(
    ...lines
      .filter((line) => line.trim() !== '')
      .map((line) => line.length - line.trimStart().length),
  );
  return lines.map((line) => line.slice(width)).join('\n');
}

function yamlBlocks(file: string): string[] {
  const text = readFileSync(join(root, file), 'utf8');
  return [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => dedent(match[1] ?? ''));
}

describe('documentation examples', () => {
  it('README files form a valid configuration', () => {
    const [settings, workflow] = yamlBlocks('README.md');
    const config = configFromFiles({
      settings: settings ?? '',
      specialists: {
        coder: 'name: Coder\n',
        reviewer: 'name: Reviewer\npermissions: read\n',
      },
      workflows: { feature: workflow ?? '' },
    });
    expect(findWorkflow(config, 'feature')?.steps).toHaveLength(2);
    expect(config.max).toBe(2);
  });

  it('the specialist and workflow examples of docs/configuration.md are valid files', () => {
    const blocks = yamlBlocks('docs/configuration.md');
    const plan = blocks.find((block) => block.startsWith('name: Planner')) ?? '';
    const workflow = blocks.find((block) => block.startsWith('split:')) ?? '';
    const config = configFromFiles({
      specialists: {
        plan,
        coder: 'name: Coder\n',
        reviewer: 'name: Reviewer\npermissions: read\n',
      },
      workflows: { feature: workflow },
    });
    expect(findSpecialist(config, 'plan')).toMatchObject({ max: 1, permissions: 'read' });
    expect(findWorkflow(config, 'feature')?.split).toEqual({
      specialist: 'plan',
      maxGroups: 5,
      additionalPrompt: 'At most one group per module.',
      workflow: null,
    });
    expect(findWorkflow(config, 'feature')?.steps[1]?.additionalPrompt).toBe(
      'Check only the tests and the error handling.',
    );
  });

  it('the epic example of docs/configuration.md splits into another workflow', () => {
    const epic =
      yamlBlocks('docs/configuration.md').find((b) => b.startsWith('# aip/workflows/epic')) ?? '';
    const config = configFromFiles({
      specialists: { plan: 'name: P\n', coder: 'name: C\n' },
      workflows: { epic, explore: 'steps:\n  - { id: research, specialist: coder }\n' },
    });
    expect(findWorkflow(config, 'epic')?.split).toMatchObject({ workflow: 'explore' });
  });

  it('the web example of docs/configuration.md is valid in the global settings', () => {
    const web = yamlBlocks('docs/configuration.md').find((block) => block.startsWith('web:')) ?? '';
    const root = mkdtempSync(join(tmpdir(), 'aip-docs-web-'));
    mkdirSync(join(root, 'xdg', 'aip'), { recursive: true });
    writeFileSync(join(root, 'xdg', 'aip', 'settings.yaml'), web);
    expect(loadWebSettings(configPaths(join(root, 'repo'), join(root, 'xdg'), undefined))).toEqual({
      autostart: true,
      auth: 'token',
      port: 7341,
      host: '127.0.0.1',
    });
  });

  it('the resolver example of docs/configuration.md is a valid specialist', () => {
    const resolver =
      yamlBlocks('docs/configuration.md').find((block) => block.includes('Resolver')) ?? '';
    const config = configFromFiles({
      settings: 'delivery: { resolver: resolver }\n',
      specialists: { resolver },
    });
    expect(config.delivery.resolver).toBe('resolver');
  });

  it('the delivery example of docs/configuration.md is valid', () => {
    const delivery =
      yamlBlocks('docs/configuration.md').find((block) => block.startsWith('delivery:')) ?? '';
    const config = configFromFiles({
      settings: delivery,
      specialists: { writer: 'name: Writer\n', resolver: 'name: Resolver\n' },
    });
    expect(config.delivery).toMatchObject({ mode: 'worktree', messageSpecialist: 'writer' });
  });

  it('the naming example of docs/configuration.md is valid', () => {
    const naming =
      yamlBlocks('docs/configuration.md').find((block) => block.startsWith('naming:')) ?? '';
    const config = configFromFiles({
      settings: naming,
      specialists: { coder: 'name: Coder\n' },
    });
    expect(config.naming).toEqual({ enabled: true, runtime: 'claude', model: 'haiku' });
  });

  it('documents the tag commands and the flags', () => {
    const readme = readFileSync(join(root, 'docs/cli.md'), 'utf8');
    for (const text of [
      'aip tag add',
      'aip tag list',
      'aip tag edit',
      'aip tag remove',
      '--tag',
      '--no-tags',
      'aip run tag',
      'aip run untag',
      'aip run list --tag',
      'swarm_queue_add',
    ]) {
      expect(readme).toContain(text);
    }
  });

  it('docs/install.md names every flag of aip setup', () => {
    const install = readFileSync(join(root, 'docs/install.md'), 'utf8');
    const setup = readFileSync(join(root, 'src/cli/commands.ts'), 'utf8');
    const flags = [...setup.matchAll(/\.option\('(?:-\w, )?(--[\w-]+)/g)].map((m) => m[1]!);
    for (const flag of [
      '--yes',
      '--dry-run',
      '--force',
      '--no-claude',
      '--no-opencode',
      '--no-plugin',
    ]) {
      expect(flags).toContain(flag);
      expect(install).toContain(`\`${flag}\``);
    }
  });

  it('user documentation is English and mentions no development files', () => {
    const files = [
      'README.md',
      ...readdirSync(join(root, 'docs'), { recursive: true })
        .map(String)
        .filter((name) => name.endsWith('.md'))
        .map((name) => join('docs', name)),
      ...readdirSync(join(root, 'examples'), { recursive: true })
        .map(String)
        .filter((name) => statSync(join(root, 'examples', name)).isFile())
        .map((name) => join('examples', name)),
    ];
    expect(files.length).toBeGreaterThan(5);
    const problems: string[] = [];
    for (const file of files) {
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/[\u0400-\u04FF]/.test(line)) problems.push(`${file}:${index + 1}: Cyrillic`);
          if (/openspec/i.test(line)) problems.push(`${file}:${index + 1}: openspec`);
        });
    }
    expect(problems).toEqual([]);
  });
});
