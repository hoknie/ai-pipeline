import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import {
  commitEdit,
  editorView,
  planEdit,
} from '../../../src/feature/swarm-edit/services/index.ts';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'aip-edit-reasoning-'));
  return configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
}

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe('OpenCode options in the configuration editor', () => {
  it.each(['project', 'global'] as const)(
    'writes and clears options at the %s level with comments and revisions',
    (level) => {
      const paths = setup();
      const file = join(paths[level].directory, 'specialists/coder.yaml');
      write(file, '# keep this comment\nname: C\nruntime: opencode\n');
      const before = editorView(paths).specialists[0]!;
      const value = { ...before.raw, variant: 'company-deep', reasoning_effort: 'high' };
      const plan = planEdit(paths, {
        kind: 'specialist',
        id: 'coder',
        value,
        level,
        revision: before.sources[level]!.revision,
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(JSON.stringify(plan));
      const committed = commitEdit(plan);
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('# keep this comment');
      expect(text).toContain('variant: company-deep');
      expect(text).toContain('reasoning_effort: high');
      expect(committed.revision).not.toBe(before.sources[level]!.revision);
      const clear = planEdit(paths, {
        kind: 'specialist',
        id: 'coder',
        value: before.raw,
        level,
        revision: committed.revision,
      });
      if (!clear.ok) throw new Error(JSON.stringify(clear));
      commitEdit(clear);
      expect(readFileSync(file, 'utf8')).toBe('# keep this comment\nname: C\nruntime: opencode\n');
      expect(editorView(paths).specialists[0]!.effective).toMatchObject({
        variant: null,
        reasoning_effort: null,
      });
    },
  );

  it.each(['project', 'global'] as const)(
    'copies settings to a new slug and an override from %s',
    (source) => {
      const paths = setup();
      const target = source === 'project' ? 'global' : 'project';
      const file = join(paths[source].directory, 'specialists/coder.yaml');
      const text = 'name: C\nruntime: opencode\nvariant: deep\nreasoning_effort: xhigh\n';
      write(file, text);
      const value = editorView(paths).specialists[0]!.raw;
      for (const id of ['coder', 'copy']) {
        const plan = planEdit(paths, {
          kind: 'specialist',
          id,
          value,
          revision: null,
          level: target,
        });
        if (!plan.ok) throw new Error(JSON.stringify(plan));
        commitEdit(plan);
        expect(
          readFileSync(join(paths[target].directory, `specialists/${id}.yaml`), 'utf8'),
        ).toContain('reasoning_effort: xhigh');
      }
      expect(readFileSync(file, 'utf8')).toBe(text);
    },
  );

  it('refuses a conflicting revision or incompatible runtime without writing', () => {
    const paths = setup();
    const file = join(paths.project.directory, 'specialists/coder.yaml');
    write(file, 'name: C\nruntime: opencode\n');
    const entry = editorView(paths).specialists[0]!;
    const invalid = planEdit(paths, {
      kind: 'specialist',
      id: 'coder',
      revision: entry.revision,
      value: { name: 'C', runtime: 'claude', variant: 'high' },
    });
    expect(invalid).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [expect.objectContaining({ path: 'swarm.specialists.coder.variant' })],
    });
    expect(readFileSync(file, 'utf8')).toBe('name: C\nruntime: opencode\n');
    write(file, '# external edit\nname: C\nruntime: opencode\n');
    expect(
      planEdit(paths, {
        kind: 'specialist',
        id: 'coder',
        revision: entry.revision,
        value: { ...entry.raw, reasoning_effort: 'high' },
      }),
    ).toMatchObject({ ok: false, reason: 'conflict' });
    expect(readFileSync(file, 'utf8')).toBe('# external edit\nname: C\nruntime: opencode\n');
  });

  it('shows both source levels but takes effective options only from the project definition', () => {
    const paths = setup();
    write(
      join(paths.global.directory, 'specialists/coder.yaml'),
      'name: Shared\nruntime: opencode\nvariant: deep\nreasoning_effort: low\n',
    );
    write(
      join(paths.project.directory, 'specialists/coder.yaml'),
      'name: Own\nruntime: opencode\nreasoning_effort: xhigh\n',
    );
    const entry = editorView(paths).specialists[0]!;
    expect(entry.sources.global!.raw).toMatchObject({ variant: 'deep', reasoning_effort: 'low' });
    expect(entry.sources.project!.raw).toMatchObject({ reasoning_effort: 'xhigh' });
    expect(entry.raw).not.toHaveProperty('variant');
    expect(entry.effective).toMatchObject({ variant: null, reasoning_effort: 'xhigh' });
  });

  it('expresses no explicit options without guessing OpenCode defaults', () => {
    const paths = setup();
    write(join(paths.project.directory, 'specialists/coder.yaml'), 'name: C\nruntime: opencode\n');
    const entry = editorView(paths).specialists[0]!;
    expect(entry.raw).toEqual({ name: 'C', runtime: 'opencode' });
    expect(entry.effective).toMatchObject({ variant: null, reasoning_effort: null });
  });
});
