import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mcpServers, runtimeCatalog, skillCatalog } from '../../src/runtime/index.ts';

function layout() {
  const base = mkdtempSync(join(tmpdir(), 'aip-catalog-'));
  const repository = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(repository, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { base, repository, home };
}

function put(path: string, content: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('skillCatalog', () => {
  it('lists project and global skills with descriptions', () => {
    const { repository, home } = layout();
    put(
      join(repository, '.claude/skills/grill-me/SKILL.md'),
      '---\ndescription: Ask hard\n---\nbody',
    );
    put(join(home, '.claude/skills/tdd/SKILL.md'), '# no frontmatter');
    const result = skillCatalog(
      [join(repository, '.claude/skills'), join(home, '.claude/skills')],
      repository,
      home,
    );
    expect(result).toEqual([
      {
        name: 'grill-me',
        source: 'project',
        file: expect.stringContaining('grill-me'),
        description: 'Ask hard',
      },
      { name: 'tdd', source: 'global', file: expect.stringContaining('tdd') },
    ]);
  });

  it('names nested commands a:b and skips deeper files', () => {
    const { repository, home } = layout();
    put(join(repository, '.claude/commands/opsx/propose.md'), 'x');
    put(join(repository, '.claude/commands/plain.md'), 'x');
    put(join(repository, '.claude/commands/a/b/c.md'), 'x');
    const names = skillCatalog([join(repository, '.claude/commands')], repository, home).map(
      (entry) => entry.name,
    );
    expect(names).toEqual(['opsx:propose', 'plain']);
  });

  it('keeps one skill per level and both levels apart', () => {
    const { repository, home } = layout();
    put(join(repository, '.claude/skills/x/SKILL.md'), '');
    put(join(repository, '.claude/commands/x.md'), '');
    put(join(home, '.claude/skills/x/SKILL.md'), '');
    const result = skillCatalog(
      [
        join(repository, '.claude/skills'),
        join(repository, '.claude/commands'),
        join(home, '.claude/skills'),
      ],
      repository,
      home,
    );
    expect(result.map((entry) => `${entry.source}:${entry.name}`)).toEqual([
      'project:x',
      'global:x',
    ]);
  });

  it('is empty without directories and ignores broken frontmatter and links', () => {
    const { base, repository, home } = layout();
    expect(skillCatalog([join(base, 'none')], repository, home)).toEqual([]);
    put(join(repository, '.claude/skills/bad/SKILL.md'), '---\ndescription: [oops\n---\n');
    put(join(repository, '.claude/skills/num/SKILL.md'), '---\ndescription: 5\n---\n');
    symlinkSync(join(base, 'missing'), join(repository, '.claude/skills/dangling'));
    const result = skillCatalog([join(repository, '.claude/skills')], repository, home);
    expect(result.map((entry) => entry.name)).toEqual(['bad', 'num']);
    expect(result.every((entry) => entry.description === undefined)).toBe(true);
  });

  it('follows links and cuts long descriptions', () => {
    const { base, repository, home } = layout();
    put(join(base, 'shared/SKILL.md'), `---\ndescription: ${'a'.repeat(500)}\n---\n`);
    mkdirSync(join(repository, '.claude/skills'), { recursive: true });
    symlinkSync(join(base, 'shared'), join(repository, '.claude/skills/linked'));
    const [entry] = skillCatalog([join(repository, '.claude/skills')], repository, home);
    expect(entry?.name).toBe('linked');
    expect(entry?.description).toHaveLength(300);
  });
});

describe('mcpServers', () => {
  it('reads both levels', () => {
    const { repository, home } = layout();
    put(join(repository, '.mcp.json'), JSON.stringify({ mcpServers: { jira: {} } }));
    put(join(home, '.claude.json'), JSON.stringify({ mcpServers: { git: {} } }));
    expect(mcpServers(repository, home).map((e) => `${e.source}:${e.name}`)).toEqual([
      'project:mcp__jira',
      'global:mcp__git',
    ]);
  });

  it('gives nothing for broken or missing files', () => {
    const { repository, home } = layout();
    put(join(repository, '.mcp.json'), '{nope');
    expect(mcpServers(repository, home)).toEqual([]);
    expect(readFileSync(join(repository, '.mcp.json'), 'utf8')).toBe('{nope');
    rmSync(join(repository, '.mcp.json'));
    put(join(home, '.claude.json'), '[1');
    expect(mcpServers(repository, home)).toEqual([]);
    rmSync(join(home, '.claude.json'));
    expect(mcpServers(repository, home)).toEqual([]);
  });
});

describe('runtimeCatalog', () => {
  it('gives claude built-in tools and opencode none', () => {
    const { repository, home } = layout();
    put(join(repository, '.mcp.json'), JSON.stringify({ mcpServers: { jira: {} } }));
    const result = runtimeCatalog(repository, home, {});
    expect(result.claude.tools).toContainEqual({ name: 'WebFetch', source: 'builtin' });
    expect(result.claude.tools.map((tool) => tool.name)).toContain('mcp__jira');
    expect(result.opencode.tools).toEqual([]);
  });
});
