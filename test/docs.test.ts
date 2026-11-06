import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  configFromFiles,
  configPaths,
  findSpecialist,
  findWorkflow,
  loadRuntimeSettings,
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

/** Lines of a file with their numbers, without fenced code blocks. */
function proseLines(file: string): { line: number; text: string }[] {
  const result: { line: number; text: string }[] = [];
  let fenced = false;
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .forEach((text, index) => {
      if (/^\s*```/.test(text)) {
        fenced = !fenced;
        return;
      }
      if (!fenced) result.push({ line: index + 1, text });
    });
  return result;
}

const docsPages = readdirSync(join(root, 'docs'), { recursive: true })
  .map(String)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => `docs/${name}`);
const userPages = ['README.md', ...docsPages];

/** The anchor GitHub gives to a heading. */
function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
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

  it('the specialist and workflow examples of the docs are valid files', () => {
    const plan =
      yamlBlocks('docs/configuration/specialists.md').find((block) =>
        block.startsWith('name: Planner'),
      ) ?? '';
    const workflow =
      yamlBlocks('docs/configuration/workflows.md').find((block) =>
        block.startsWith('name: New feature'),
      ) ?? '';
    const config = configFromFiles({
      specialists: {
        plan,
        coder: 'name: Coder\n',
        reviewer: 'name: Reviewer\npermissions: read\n',
      },
      workflows: { feature: workflow },
    });
    expect(findSpecialist(config, 'plan')).toMatchObject({ max: 1, permissions: 'read' });
    expect(findWorkflow(config, 'feature')?.name).toBe('New feature');
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

  it('the epic example of docs/configuration/workflows.md splits into another workflow', () => {
    const epic =
      yamlBlocks('docs/configuration/workflows.md').find((b) =>
        b.startsWith('# aip/workflows/epic'),
      ) ?? '';
    const config = configFromFiles({
      specialists: { plan: 'name: P\n', coder: 'name: C\n' },
      workflows: { epic, explore: 'steps:\n  - { id: research, specialist: coder }\n' },
    });
    expect(findWorkflow(config, 'epic')?.split).toMatchObject({ workflow: 'explore' });
  });

  it('the runtimes example of docs/configuration/runtimes.md is valid in the global settings', () => {
    const block =
      yamlBlocks('docs/configuration/runtimes.md').find((b) => b.startsWith('runtimes:')) ?? '';
    const root = mkdtempSync(join(tmpdir(), 'aip-docs-runtimes-'));
    mkdirSync(join(root, 'xdg', 'aip'), { recursive: true });
    writeFileSync(join(root, 'xdg', 'aip', 'settings.yaml'), block);
    const runtimes = loadRuntimeSettings(
      configPaths(join(root, 'repo'), join(root, 'xdg'), undefined),
    );
    expect(runtimes.opencode).toEqual({ command: 'npx', args: ['-y', 'opencode-ai'], env: {} });
    expect(runtimes.claude.args).toEqual(['--debug']);
  });

  it('the web example of docs/configuration/README.md is valid in the global settings', () => {
    const web =
      yamlBlocks('docs/configuration/README.md').find((block) => block.startsWith('web:')) ?? '';
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

  it('the resolver example of docs/configuration/delivery.md is a valid specialist', () => {
    const resolver =
      yamlBlocks('docs/configuration/delivery.md').find((block) => block.includes('Resolver')) ??
      '';
    const config = configFromFiles({
      settings: 'delivery: { resolver: resolver }\n',
      specialists: { resolver },
    });
    expect(config.delivery.resolver).toBe('resolver');
  });

  it('the delivery example of docs/configuration/delivery.md is valid', () => {
    const delivery =
      yamlBlocks('docs/configuration/delivery.md').find((block) => block.startsWith('delivery:')) ??
      '';
    const config = configFromFiles({
      settings: delivery,
      specialists: { writer: 'name: Writer\n', resolver: 'name: Resolver\n' },
    });
    expect(config.delivery).toMatchObject({ mode: 'worktree', messageSpecialist: 'writer' });
  });

  it('the naming example of docs/configuration/README.md is valid', () => {
    const naming =
      yamlBlocks('docs/configuration/README.md').find((block) => block.startsWith('naming:')) ?? '';
    const config = configFromFiles({
      settings: naming,
      specialists: { coder: 'name: Coder\n' },
    });
    expect(config.naming).toEqual({ enabled: true, runtime: 'claude', model: 'haiku' });
  });

  it('documents the tag commands and the flags', () => {
    const readme =
      readFileSync(join(root, 'docs/usage/tags.md'), 'utf8') +
      readFileSync(join(root, 'docs/hosts/mcp-tools.md'), 'utf8');
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

  it('docs/getting-started/install.md names every flag of aip setup', () => {
    const install = readFileSync(join(root, 'docs/getting-started/install.md'), 'utf8');
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

  it('document the queue settings', () => {
    const queue = readFileSync(join(root, 'docs/usage/queue.md'), 'utf8');
    for (const text of [
      'aip queue settings',
      '--autopilot on\\|off',
      '--auto-answer on\\|off',
      '--skip-failed on\\|off',
      'Skipped with a problem:',
    ]) {
      expect(queue).toContain(text);
    }
    const hosts = readFileSync(join(root, 'docs/hosts/mcp-tools.md'), 'utf8');
    expect(hosts.split('\n').find((line) => line.includes('| `swarm_queue_settings`'))).toContain(
      'skip_failed?',
    );
    const web = readFileSync(join(root, 'docs/web/queue.md'), 'utf8');
    expect(web).toContain('"Queue settings"');
    expect(web).toContain('"Skipped with a problem"');
  });

  it('documents the pause and the freezing of runs', () => {
    const queue = readFileSync(join(root, 'docs/usage/queue.md'), 'utf8');
    for (const text of ['### Pausing a run', 'aip run pause', '### Freezing', 'frozen <run-id>']) {
      expect(queue).toContain(text);
    }
    const hosts = readFileSync(join(root, 'docs/hosts/mcp-tools.md'), 'utf8');
    expect(hosts).toContain('| `swarm_run_pause`');
    expect(hosts.split('\n').find((line) => line.includes('| `swarm_queue_run_now`'))).toContain(
      'frozen',
    );
  });

  it('document the dependencies of queue tasks', () => {
    const queue = readFileSync(join(root, 'docs/usage/queue.md'), 'utf8');
    expect(queue).toContain('--after <id>');
    expect(queue).toContain('--no-after');
    const web = readFileSync(join(root, 'docs/web/queue.md'), 'utf8');
    expect(web).toContain('"Waits for"');
    expect(web).toContain('Dependencies are not met');
    const hosts = readFileSync(join(root, 'docs/hosts/mcp-tools.md'), 'utf8');
    expect(hosts.split('\n').find((line) => line.includes('| `swarm_queue_add`'))).toContain(
      'after?',
    );
  });
});

describe('documentation structure', () => {
  it('proseLines skips fenced code blocks', () => {
    const lines = proseLines('docs/usage/tags.md').map((entry) => entry.text);
    expect(lines).toContain('## Managing tags');
    expect(lines).not.toContain(
      'aip tag list                             # the catalog of the repository (--json)',
    );
    expect(lines.some((line) => line.startsWith('```'))).toBe(false);
  });

  it('links and anchors resolve', () => {
    const problems: string[] = [];
    for (const file of userPages) {
      for (const { line, text } of proseLines(file)) {
        for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          const target = match[1]!;
          if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
          const [path = '', hash] = target.split('#');
          const targetFile = path === '' ? file : join(dirname(file), path);
          if (!existsSync(join(root, targetFile))) {
            problems.push(`${file}:${line}: ${target} (no such file)`);
            continue;
          }
          if (hash === undefined || !targetFile.endsWith('.md')) continue;
          const anchors = proseLines(targetFile)
            .filter((entry) => /^#{1,6} /.test(entry.text))
            .map((entry) => anchor(entry.text.replace(/^#+ /, '')));
          if (!anchors.includes(hash))
            problems.push(`${file}:${line}: ${target} (no such heading)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every docs page is listed in the docs index', () => {
    const index = readFileSync(join(root, 'docs/README.md'), 'utf8');
    for (const page of docsPages.filter((name) => name !== 'docs/README.md')) {
      expect(index).toContain(`(${page.slice('docs/'.length)})`);
    }
  });

  it('README and the help footer lead to the docs index', () => {
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('(docs/README.md)');
    expect(readFileSync(join(root, 'src/cli/help.ts'), 'utf8')).toContain('docs/README.md');
  });

  it('prose lines are short', () => {
    const problems: string[] = [];
    for (const file of userPages) {
      for (const { line, text } of proseLines(file)) {
        if (text.length > 400) problems.push(`${file}:${line}: ${text.length} characters`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has no comparative phrases', () => {
    const phrases = [
      'the old way',
      'unlike',
      'as before',
      'the same as',
      'the same way',
      'the same path',
      'the former',
      'as with',
      ' like `',
      'does the same',
      'work the same',
      'by the same',
      'the same graph',
    ];
    const problems: string[] = [];
    for (const file of userPages) {
      for (const { line, text } of proseLines(file)) {
        const lower = text.toLowerCase();
        for (const phrase of phrases) {
          if (lower.includes(phrase)) problems.push(`${file}:${line}: "${phrase}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
