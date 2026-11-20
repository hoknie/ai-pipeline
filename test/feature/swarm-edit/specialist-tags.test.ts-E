import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigEditError, type TagPlan } from '../../../src/feature/swarm-edit/types/index.ts';
import {
  commitEdits,
  normalizeTags,
  planImport,
  planTagRemove,
  planTagRename,
  planTagsSet,
  revisionOf,
  tagFolder,
} from '../../../src/feature/swarm-edit/services/index.ts';
import { configPaths } from '../../../src/feature/swarm-config/services/index.ts';
import { tagsOf, type ConfigPaths } from '../../../src/feature/swarm-config/types/index.ts';

function setup(): { root: string; app: ConfigPaths; lib: ConfigPaths } {
  const root = mkdtempSync(join(tmpdir(), 'aip-tags-'));
  const xdg = join(root, 'xdg');
  return {
    root,
    app: configPaths(join(root, 'app'), xdg, undefined),
    lib: configPaths(join(root, 'lib'), xdg, undefined),
  };
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const file = (paths: ConfigPaths, level: 'global' | 'project', slug: string) =>
  join(paths[level].directory, 'specialists', `${slug}.yaml`);

function accepted(plan: TagPlan) {
  if (!plan.ok) throw new Error(`expected an accepted plan: ${JSON.stringify(plan)}`);
  return plan;
}

describe('tag names', () => {
  it('merges repeats that differ in case, also in Cyrillic', () => {
    expect(normalizeTags(['Backend', 'backend '])).toEqual(['Backend']);
    expect(normalizeTags(['Бэкенд', 'бэкенд'])).toEqual(['Бэкенд']);
  });

  it('rejects empty, long and multi-line names', () => {
    expect(() => normalizeTags([' '])).toThrow(ConfigEditError);
    expect(() => normalizeTags(['a'.repeat(31)])).toThrow(ConfigEditError);
    expect(() => normalizeTags(['a\nb'])).toThrow(ConfigEditError);
    expect(() => normalizeTags([3])).toThrow(ConfigEditError);
    expect(normalizeTags(['a'.repeat(30)])).toHaveLength(1);
  });

  it('reads the tags of a parsed file and ignores a wrong value', () => {
    expect(tagsOf({ tags: ['a', ' A ', 'b'] })).toEqual(['a', 'b']);
    expect(tagsOf({ tags: 'a' })).toEqual([]);
    expect(tagsOf({ tags: ['a', 1] })).toEqual([]);
    expect(tagsOf(undefined)).toEqual([]);
  });
});

describe('tagFolder', () => {
  it('lists the specialists of a level in slug order', () => {
    const { app } = setup();
    write(file(app, 'project', 'plan'), 'name: Plan\ntags: [fast]\n');
    write(file(app, 'project', 'coder'), 'name: Coder\n');
    const folder = tagFolder(app, 'project');
    expect(folder.directory).toBe(join(app.project.directory, 'specialists'));
    expect(folder.specialists).toEqual([
      { slug: 'coder', name: 'Coder', tags: [], revision: expect.any(String) },
      { slug: 'plan', name: 'Plan', tags: ['fast'], revision: expect.any(String) },
    ]);
  });

  it('gives an empty list for a level without a directory', () => {
    const { app } = setup();
    expect(tagFolder(app, 'project').specialists).toEqual([]);
    expect(tagFolder(app, 'global').specialists).toEqual([]);
  });

  it('reports a broken file and keeps the others', () => {
    const { app } = setup();
    write(file(app, 'project', 'bad'), 'name: [unclosed\n');
    write(file(app, 'project', 'good'), 'name: Good\ntags: [x]\n');
    const folder = tagFolder(app, 'project');
    expect(folder.specialists.map((item) => item.slug)).toEqual(['bad', 'good']);
    expect(folder.specialists[0]?.error).toEqual(expect.any(String));
    expect(folder.specialists[1]?.tags).toEqual(['x']);
  });
});

describe('editing tags', () => {
  it('sets the tags and keeps comments and key order', () => {
    const { app } = setup();
    const path = file(app, 'global', 'qa');
    write(path, '# shared qa\nname: QA # name\nmodel: a\n');
    const text = readFileSync(path, 'utf8');
    const { edits } = accepted(
      planTagsSet(app, 'global', 'qa', ['review', 'fast'], revisionOf(text)),
    );
    commitEdits(edits);
    const result = readFileSync(path, 'utf8');
    expect(result).toContain('# shared qa');
    expect(result).toContain('name: QA # name');
    expect(result).toContain('tags:');
    expect(tagFolder(app, 'global').specialists[0]?.tags).toEqual(['review', 'fast']);
    expect(result.indexOf('model: a')).toBeLessThan(result.indexOf('tags:'));
  });

  it('removes the key for an empty list', () => {
    const { app } = setup();
    const path = file(app, 'project', 'qa');
    write(path, 'name: QA\ntags: [a]\n');
    const { edits } = accepted(
      planTagsSet(app, 'project', 'qa', [], revisionOf(readFileSync(path, 'utf8'))),
    );
    commitEdits(edits);
    expect(readFileSync(path, 'utf8')).toBe('name: QA\n');
  });

  it('rejects a changed revision, a missing file and a bad name without writing', () => {
    const { app } = setup();
    const path = file(app, 'project', 'qa');
    write(path, 'name: QA\n');
    expect(planTagsSet(app, 'project', 'qa', ['a'], 'old')).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(planTagsSet(app, 'project', 'nope', ['a'], null)).toMatchObject({
      ok: false,
      reason: 'conflict',
    });
    expect(
      planTagsSet(app, 'project', 'qa', ['a'.repeat(31)], revisionOf('name: QA\n')),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(planTagsSet(app, 'project', 'Bad Slug', [], null)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(readFileSync(path, 'utf8')).toBe('name: QA\n');
  });

  it('renames a tag in every specialist of the level and merges repeats', () => {
    const { app, lib } = setup();
    write(file(app, 'project', 'coder'), '# c\nname: C\ntags: [Legacy, backend]\n');
    write(file(app, 'project', 'plan'), 'name: P\ntags: [old, legacy]\n');
    write(file(app, 'project', 'other'), 'name: O\ntags: [x]\n');
    write(file(lib, 'project', 'coder'), 'name: C\ntags: [legacy]\n');
    const { edits } = accepted(planTagRename(app, 'project', 'legacy', 'old'));
    expect(edits).toHaveLength(2);
    commitEdits(edits);
    const tags = Object.fromEntries(
      tagFolder(app, 'project').specialists.map((item) => [item.slug, item.tags]),
    );
    expect(tags).toEqual({ coder: ['old', 'backend'], plan: ['old'], other: ['x'] });
    expect(readFileSync(file(app, 'project', 'coder'), 'utf8')).toContain('# c');
    expect(readFileSync(file(lib, 'project', 'coder'), 'utf8')).toContain('legacy');
  });

  it('removes a tag and rejects an unknown one', () => {
    const { app } = setup();
    write(file(app, 'global', 'qa'), 'name: QA\ntags: [review]\n');
    write(file(app, 'global', 'lint'), 'name: L\ntags: [Review, fast]\n');
    commitEdits(accepted(planTagRemove(app, 'global', 'review')).edits);
    expect(tagFolder(app, 'global').specialists.map((item) => item.tags)).toEqual([['fast'], []]);
    expect(planTagRemove(app, 'global', 'nope')).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [expect.objectContaining({ message: 'unknown specialist tag `nope`' })],
    });
  });

  it('refuses a rename to an invalid name', () => {
    const { app } = setup();
    write(file(app, 'global', 'qa'), 'name: QA\ntags: [review]\n');
    expect(planTagRename(app, 'global', 'review', ' ')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('skips a broken file when it renames', () => {
    const { app } = setup();
    write(file(app, 'project', 'bad'), 'name: [unclosed\n');
    write(file(app, 'project', 'good'), 'name: G\ntags: [a]\n');
    commitEdits(accepted(planTagRename(app, 'project', 'a', 'b')).edits);
    expect(readFileSync(file(app, 'project', 'bad'), 'utf8')).toBe('name: [unclosed\n');
    expect(tagFolder(app, 'project').specialists[1]?.tags).toEqual(['b']);
  });
});

describe('importing specialists', () => {
  it('copies the files byte for byte with their tags', () => {
    const { app, lib } = setup();
    const coder = '# c\nname: Coder\ntags: [backend]\nmodel: a\n';
    write(file(lib, 'project', 'coder'), coder);
    write(file(lib, 'project', 'plan'), 'name: Plan\n');
    commitEdits(accepted(planImport(app, lib, ['coder', 'plan'])).edits);
    expect(readFileSync(file(app, 'project', 'coder'), 'utf8')).toBe(coder);
    expect(readFileSync(file(app, 'project', 'plan'), 'utf8')).toBe('name: Plan\n');
    expect(tagFolder(app, 'project').specialists[0]?.tags).toEqual(['backend']);
  });

  it('refuses a slug the source does not have', () => {
    const { app, lib } = setup();
    write(file(lib, 'project', 'plan'), 'name: Plan\n');
    const plan = planImport(app, lib, ['plan', 'ghost']);
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
    expect(JSON.stringify(plan)).toContain('specialist `ghost` is not defined in');
    expect(existsSync(file(app, 'project', 'plan'))).toBe(false);
  });

  it('refuses all when one slug is taken', () => {
    const { app, lib } = setup();
    write(file(lib, 'project', 'coder'), 'name: Coder\n');
    write(file(lib, 'project', 'plan'), 'name: Plan\n');
    write(file(app, 'project', 'coder'), 'name: Mine\n');
    const plan = planImport(app, lib, ['coder', 'plan']);
    expect(plan).toMatchObject({ ok: false, reason: 'conflict', slugs: ['coder'] });
    expect(existsSync(file(app, 'project', 'plan'))).toBe(false);
  });

  it('refuses a file that breaks the configuration', () => {
    const { app, lib } = setup();
    write(file(lib, 'project', 'review'), 'name: R\nruntime: nope\n');
    write(file(lib, 'project', 'plan'), 'name: Plan\n');
    const plan = planImport(app, lib, ['plan', 'review']);
    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [expect.objectContaining({ path: 'swarm.specialists.review.runtime' })],
    });
    expect(existsSync(file(app, 'project', 'plan'))).toBe(false);
  });

  it('removes the files already written when a later write fails', () => {
    const { app, lib } = setup();
    write(file(lib, 'project', 'a'), 'name: A\n');
    write(file(lib, 'project', 'b'), 'name: B\n');
    const { edits } = accepted(planImport(app, lib, ['a', 'b']));
    // a regular file where the directory of the second file should be makes its write fail
    const blocked = { ...edits[1]!, file: join(file(app, 'project', 'a'), 'inside', 'b.yaml') };
    expect(() => commitEdits([edits[0]!, blocked])).toThrow();
    expect(existsSync(file(app, 'project', 'a'))).toBe(false);
  });
});
