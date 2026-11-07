import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConfigEditorView } from '../../src/feature/swarm-edit/types/index.ts';
import type {
  SpecialistTagsResult,
  SpecialistTagsView,
  SpecialistsImportResult,
} from '../../src/protocol/index.ts';

import { harness, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

function newRepository(): string {
  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'aip-tags-'))), 'lib');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  return repo;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const projectFile = (repo: string, slug: string) =>
  join(repo, 'aip', 'specialists', `${slug}.yaml`);

/** A daemon with the shared qa, a project coder in the first repository and a second repository. */
async function start(): Promise<{ h: Harness; app: string; lib: string; shared: string }> {
  const h = (current = await harness());
  const lib = newRepository();
  const shared = join(dirname(h.state), 'xdg', 'aip', 'specialists');
  write(join(shared, 'qa.yaml'), 'name: QA\ntags: [review]\n');
  write(projectFile(h.repo, 'coder'), 'name: Coder\ntags: [legacy]\n');
  write(projectFile(lib, 'coder'), 'name: Lib coder\ntags: [backend, legacy]\n');
  write(projectFile(lib, 'plan'), 'name: Plan\n');
  await h.call('config', { repository: h.repo });
  await h.call('config', { repository: lib });
  return { h, app: h.repo, lib, shared };
}

const folders = async (h: Harness) =>
  ((await h.call('specialist_tags', {})) as SpecialistTagsView).folders;

describe('specialist tags', () => {
  it('lists the shared folder and one folder per repository of the registry', async () => {
    const { h, app, lib } = await start();
    const result = await folders(h);
    expect(result.map((folder) => folder.repository)).toEqual([null, ...[app, lib].sort()]);
    const byRepository = new Map(result.map((folder) => [folder.repository, folder]));
    expect(byRepository.get(null)?.specialists.map((s) => [s.slug, s.tags])).toEqual([
      ['qa', ['review']],
    ]);
    expect(byRepository.get(app)?.specialists.map((s) => [s.slug, s.tags])).toEqual([
      ['coder', ['legacy']],
      ['reviewer', []],
    ]);
  });

  it('shows a shared tag in the configuration of every repository', async () => {
    const { h, app, lib } = await start();
    const folder = (await folders(h))[0]!;
    const set = (await h.call('specialist_tags_set', {
      repository: null,
      slug: 'qa',
      tags: ['review', 'fast'],
      revision: folder.specialists[0]!.revision!,
    })) as SpecialistTagsResult;
    expect(set).toMatchObject({ ok: true, folder: { repository: null } });
    for (const repository of [app, lib]) {
      const view = (await h.call('config', { repository })) as ConfigEditorView;
      expect(view.specialists.find((s) => s.slug === 'qa')?.shared_tags).toEqual([
        'review',
        'fast',
      ]);
    }
  });

  it('refuses a stale revision as a conflict and leaves the file', async () => {
    const { h, shared } = await start();
    const before = readFileSync(join(shared, 'qa.yaml'), 'utf8');
    const result = await h.call('specialist_tags_set', {
      repository: null,
      slug: 'qa',
      tags: ['x'],
      revision: 'stale',
    });
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(readFileSync(join(shared, 'qa.yaml'), 'utf8')).toBe(before);
  });

  it('renames a tag in one repository only', async () => {
    const { h, app, lib, shared } = await start();
    const result = (await h.call('specialist_tag_rename', {
      repository: app,
      from: 'Legacy',
      to: 'old',
    })) as SpecialistTagsResult;
    expect(result).toMatchObject({ ok: true });
    expect(readFileSync(projectFile(app, 'coder'), 'utf8')).toContain('old');
    expect(readFileSync(projectFile(lib, 'coder'), 'utf8')).toContain('legacy');
    expect(readFileSync(join(shared, 'qa.yaml'), 'utf8')).toContain('review');
  });

  it('removes a tag from a folder and refuses an unknown one', async () => {
    const { h, shared } = await start();
    expect(
      await h.call('specialist_tag_remove', { repository: null, tag: 'review' }),
    ).toMatchObject({
      ok: true,
    });
    expect(readFileSync(join(shared, 'qa.yaml'), 'utf8')).not.toContain('review');
    expect(await h.call('specialist_tag_remove', { repository: null, tag: 'nope' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a repository that is not in the registry', async () => {
    const { h } = await start();
    await expect(
      h.call('specialist_tag_remove', { repository: '/nowhere', tag: 'a' }),
    ).rejects.toThrow(/unknown repository/);
  });

  it('imports specialists byte for byte with their tags', async () => {
    const { h, app, lib } = await start();
    const result = (await h.call('specialists_import', {
      repository: app,
      source: lib,
      slugs: ['plan'],
    })) as SpecialistsImportResult;
    expect(result).toEqual({ ok: true, imported: ['plan'] });
    expect(readFileSync(projectFile(app, 'plan'), 'utf8')).toBe(
      readFileSync(projectFile(lib, 'plan'), 'utf8'),
    );
  });

  it('refuses an import with a taken slug and writes nothing', async () => {
    const { h, app, lib } = await start();
    const result = await h.call('specialists_import', {
      repository: app,
      source: lib,
      slugs: ['coder', 'plan'],
    });
    expect(result).toMatchObject({ ok: false, reason: 'conflict', slugs: ['coder'] });
    expect(existsSync(projectFile(app, 'plan'))).toBe(false);
  });

  it('refuses a source outside the registry, the repository itself and a missing slug', async () => {
    const { h, app, lib } = await start();
    await expect(
      h.call('specialists_import', { repository: app, source: '/tmp/other', slugs: ['plan'] }),
    ).rejects.toThrow(/unknown repository/);
    await expect(
      h.call('specialists_import', { repository: app, source: app, slugs: ['plan'] }),
    ).rejects.toThrow(/another repository/);
    expect(
      await h.call('specialists_import', { repository: app, source: lib, slugs: ['ghost'] }),
    ).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('refuses an import that breaks the configuration', async () => {
    const { h, app, lib } = await start();
    write(projectFile(lib, 'review'), 'name: R\nruntime: nope\n');
    const result = await h.call('specialists_import', {
      repository: app,
      source: lib,
      slugs: ['review'],
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
      errors: [expect.objectContaining({ path: 'swarm.specialists.review.runtime' })],
    });
    expect(existsSync(projectFile(app, 'review'))).toBe(false);
  });
});
