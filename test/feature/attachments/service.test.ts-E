import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  AttachmentRepository,
  FileAttachmentStorage,
  type AttachmentStorage,
} from '../../../src/feature/attachments/repositories/index.ts';
import { AttachmentService } from '../../../src/feature/attachments/services/index.ts';
import { temporaryStorage } from '../storage.ts';
import { run } from '../runs/helpers.ts';

let base: string;
let root: string;
let service: AttachmentService;
let repository: AttachmentRepository;
let storage: FileAttachmentStorage;

function source(name: string, bytes: string | Buffer = name): string {
  const directory = join(base, 'src');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), bytes);
  return join(directory, name);
}

const stored = () =>
  existsSync(root) ? readdirSync(root).flatMap((o) => readdirSync(join(root, o))) : [];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'aip-attsvc-'));
  root = join(base, 'attachments');
  repository = new AttachmentRepository(temporaryStorage().database);
  storage = new FileAttachmentStorage(root);
  service = new AttachmentService({ attachments: repository, storages: [storage], now: () => 1 });
});

describe('ingest', () => {
  it('copies files, names them after the path or the given name and gives their types', async () => {
    const refs = await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [
        { path: source('shot.png', 'x'.repeat(2048)) },
        { path: source('a.txt'), name: 'b.txt' },
      ],
    });
    expect(refs.map(({ fileName, size, mediaType }) => [fileName, size, mediaType])).toEqual([
      ['shot.png', 2048, 'image/png'],
      ['b.txt', 5, 'text/plain'],
    ]);
    expect(service.listOf('q1')).toEqual(refs);
    expect(stored()).toHaveLength(2);
  });

  it('refuses 11 files, 25 MB, a repeated name, a relative path and a directory', async () => {
    const one = source('a.txt');
    const refuse = (sources: { path: string; name?: string }[], message: string) =>
      expect(service.ingest({ repository: '/repo', itemId: 'q1', sources })).rejects.toThrow(
        message,
      );
    await refuse(
      Array.from({ length: 11 }, (_, index) => ({ path: one, name: `f${index}` })),
      'at most 10 attachments',
    );
    await refuse([{ path: source('big.bin', Buffer.alloc(25 * 1024 * 1024)) }], '20.0 MB');
    await refuse([{ path: one }, { path: one }], 'repeated');
    await refuse([{ path: 'a.txt' }], 'must be absolute');
    await refuse([{ path: base }], 'not a regular file');
    await refuse([{ path: join(base, 'missing') }], 'not readable');
    expect(stored()).toEqual([]);
    expect(service.listOf('q1')).toEqual([]);
  });

  it('counts the attachments the task already has', async () => {
    const sources = Array.from({ length: 10 }, (_, index) => ({
      path: source('a.txt'),
      name: `f${index}`,
    }));
    await service.ingest({ repository: '/repo', itemId: 'q1', sources });
    await expect(
      service.ingest({ repository: '/repo', itemId: 'q1', sources: [{ path: source('a.txt') }] }),
    ).rejects.toThrow('at most 10 attachments');
    expect(service.listOf('q1')).toHaveLength(10);
  });

  it('rolls back the stored bytes when a later file cannot be read', async () => {
    const good = source('a.txt');
    const broken = join(base, 'src', 'link');
    symlinkSync(join(base, 'nowhere'), broken);
    await expect(
      service.ingest({
        repository: '/repo',
        itemId: 'q1',
        sources: [{ path: good }, { path: broken }],
      }),
    ).rejects.toThrow('not readable');
    expect(stored()).toEqual([]);
    expect(service.listOf('q1')).toEqual([]);
  });

  it('does not depend on the source after the copy', async () => {
    const path = source('a.txt', 'first');
    const [ref] = await service.ingest({ repository: '/repo', itemId: 'q1', sources: [{ path }] });
    writeFileSync(path, 'changed');
    service.bindToRun('q1', 'r1');
    const content = await service.content('r1', ref!.id);
    expect(content.bytes.toString()).toBe('first');
  });

  it('replaces an attachment: detach and attach with the same name', async () => {
    await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt', 'old') }],
    });
    const [ref] = await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt', 'new') }],
      detach: ['a.txt'],
    });
    expect(service.listOf('q1')).toEqual([ref]);
    expect(stored()).toHaveLength(1);
    await expect(
      service.ingest({ repository: '/repo', itemId: 'q1', sources: [], detach: ['nope'] }),
    ).rejects.toThrow('no attachment `nope`');
  });
});

describe('detach, removeOwner and bindToRun', () => {
  it('deletes the bytes of a detached attachment and of a removed item', async () => {
    await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt') }, { path: source('b.txt') }],
    });
    await service.detach('q1', ['a.txt']);
    expect(service.listOf('q1').map((ref) => ref.fileName)).toEqual(['b.txt']);
    expect(stored()).toHaveLength(1);
    await service.removeOwner('q1');
    expect(stored()).toEqual([]);
  });

  it('keeps what a run owns when the item goes', async () => {
    await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt') }],
    });
    service.bindToRun('q1', 'r1');
    await service.removeOwner('q1');
    expect(service.listOfRun('r1')).toHaveLength(1);
    expect(stored()).toHaveLength(1);
  });

  it('gives the content only through the run that owns the attachment', async () => {
    const [ref] = await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt') }],
    });
    service.bindToRun('q1', 'r1');
    await expect(service.content('r2', ref!.id)).rejects.toThrow('unknown attachment');
    await storage.remove(repository.byId(ref!.id)!.uri);
    await expect(service.content('r1', ref!.id)).rejects.toThrow('is not available');
  });

  it('reports a link of an unknown scheme as not available but keeps it listed', async () => {
    repository.add([
      {
        id: 'a1',
        repository: '/repo',
        itemId: 'q1',
        runId: 'r1',
        fileName: 'a.txt',
        size: 1,
        mediaType: 'text/plain',
        uri: 's3://bucket/q1/a1',
        createdAt: 1,
      },
    ]);
    expect(service.listOfRun('r1')).toHaveLength(1);
    await expect(service.content('r1', 'a1')).rejects.toThrow('is not available');
  });
});

describe('materialize', () => {
  function started(files: Record<string, string>) {
    const state = run(1);
    state.run.config.workspaceDir = join(base, 'workspace');
    return { state, files };
  }

  async function attached(files: Record<string, string>) {
    const { state } = started(files);
    const refs = await service.ingest({
      repository: state.run.repository,
      itemId: 'q1',
      sources: Object.entries(files).map(([name, bytes]) => ({ path: source(name, bytes) })),
    });
    service.bindToRun('q1', state.run.id);
    state.run.attachments = refs;
    return state;
  }

  it('lays the files out in the run folder of the workspace and returns the folder', async () => {
    const state = await attached({ 'shot.png': 'png-bytes', 'a.txt': 'text' });
    const folder = await service.materialize(state.run);
    expect(folder).toBe(join(base, 'workspace', 'logs', state.run.id, '_attachments'));
    expect(readFileSync(join(folder!, 'shot.png'), 'utf8')).toBe('png-bytes');
    expect(readFileSync(join(folder!, 'a.txt'), 'utf8')).toBe('text');
    expect(readdirSync(folder!).sort()).toEqual(['a.txt', 'shot.png']);
  });

  it('does nothing for a run without attachments', async () => {
    const state = run(1);
    state.run.config.workspaceDir = join(base, 'workspace');
    expect(await service.materialize(state.run)).toBeNull();
    expect(existsSync(join(base, 'workspace'))).toBe(false);
  });

  it('lays the files out again on every call', async () => {
    const state = await attached({ 'a.txt': 'text' });
    const first = await service.materialize(state.run);
    expect(await service.materialize(state.run)).toBe(first);
    expect(readFileSync(join(first!, 'a.txt'), 'utf8')).toBe('text');
  });

  it('overwrites a spoiled copy, also one of the same size', async () => {
    const state = await attached({ 'a.txt': 'ORIGINAL' });
    const folder = (await service.materialize(state.run))!;
    writeFileSync(join(folder, 'a.txt'), 'SPOILED!');
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toHaveLength(8);
    await service.materialize(state.run);
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('ORIGINAL');
    writeFileSync(join(folder, 'a.txt'), 'short');
    await service.materialize(state.run);
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it('fails with the name of an attachment whose bytes are gone', async () => {
    const state = await attached({ 'a.txt': 'text' });
    await storage.remove(repository.ofRun(state.run.id)[0]!.uri);
    await expect(service.materialize(state.run)).rejects.toThrow(
      'attachment a.txt is not available',
    );
  });
});

describe('sweep', () => {
  const live = (items: string[], runs: string[]) => ({
    items: new Set(items),
    hasRun: (id: string) => runs.includes(id),
  });

  it('deletes records without an item or a run, and files without a record', async () => {
    await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt') }],
    });
    await service.ingest({
      repository: '/repo',
      itemId: 'q2',
      sources: [{ path: source('b.txt') }],
    });
    await service.ingest({
      repository: '/repo',
      itemId: 'q3',
      sources: [{ path: source('c.txt') }],
    });
    service.bindToRun('q3', 'r1');
    mkdirSync(join(root, 'stray'));
    writeFileSync(join(root, 'stray', 'x'), 'x');
    await service.sweep(live(['q1'], []));
    expect(service.listOf('q1')).toHaveLength(1);
    expect(service.listOf('q2')).toEqual([]);
    expect(service.listOfRun('r1')).toEqual([]);
    expect(stored()).toHaveLength(1);
    expect(existsSync(join(root, 'stray'))).toBe(false);
  });

  it('keeps a run that is stored', async () => {
    await service.ingest({
      repository: '/repo',
      itemId: 'q1',
      sources: [{ path: source('a.txt') }],
    });
    service.bindToRun('q1', 'r1');
    await service.sweep(live([], ['r1']));
    expect(service.listOfRun('r1')).toHaveLength(1);
    expect(stored()).toHaveLength(1);
  });

  it('leaves a link of another scheme alone', async () => {
    const remote: AttachmentStorage = {
      handles: (uri) => uri.startsWith('s3:'),
      put: async () => 's3://b/k',
      get: async () => null,
      remove: async () => {
        throw new Error('must not be called');
      },
      sweep: async () => undefined,
    };
    repository.add([
      {
        id: 'a1',
        repository: '/repo',
        itemId: 'q1',
        runId: 'r1',
        fileName: 'a.txt',
        size: 1,
        mediaType: 'text/plain',
        uri: 's3://bucket/q1/a1',
        createdAt: 1,
      },
    ]);
    const mixed = new AttachmentService({
      attachments: repository,
      storages: [storage, remote],
      now: () => 1,
    });
    await mixed.sweep(live([], ['r1']));
    expect(repository.ofRun('r1')).toHaveLength(1);
  });
});
