import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AttachmentContentView,
  QueueView,
  RunQueued,
} from '../../src/presentation/ipc/contract/index.ts';
import { CODE_ONLY_CONFIG, git, type Harness } from './harness.ts';
import { add, itemById, queueOf, start, waitQueue } from './queue-harness.ts';

const PNG = Buffer.alloc(2048, 7);

/** Files the test attaches, in a folder of their own outside the repository. */
function files(h: Harness, entries: Record<string, Buffer | string>): Record<string, string> {
  const directory = join(h.state, '..', 'sources');
  mkdirSync(directory, { recursive: true });
  const paths: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    paths[name] = join(directory, name);
    writeFileSync(paths[name]!, bytes);
  }
  return paths;
}

async function started(h: Harness) {
  h.environment.AIP_FAKE_ARGV_LOG = join(h.fakeState, 'argv.jsonl');
  mkdirSync(h.fakeState, { recursive: true });
}

function agentCalls(h: Harness): { argv: string[] }[] {
  const file = join(h.fakeState, 'argv.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { argv: string[] })
    .filter((call) => call.argv.includes('--session-id') || call.argv.includes('--resume'));
}

const stored = (h: Harness) => {
  const root = join(h.state, 'attachments');
  return existsSync(root)
    ? readdirSync(root).flatMap((owner) => readdirSync(join(root, owner)))
    : [];
};

describe('attachments of a task in the queue', () => {
  it('attaches files, lists them and deletes their bytes with the item', async () => {
    const h = await start();
    const paths = files(h, { 'shot.png': PNG, 'spec.pdf': 'pdf' });
    const view = await add(h, 'A', {
      attachments: [{ path: paths['shot.png']! }, { path: paths['spec.pdf']!, name: 'brief.pdf' }],
    });
    const item = view.items[0]!;
    expect(
      item.attachments.map(({ fileName, size, mediaType }) => ({ fileName, size, mediaType })),
    ).toEqual([
      { fileName: 'shot.png', size: 2048, mediaType: 'image/png' },
      { fileName: 'brief.pdf', size: 3, mediaType: 'application/pdf' },
    ]);
    expect(stored(h)).toHaveLength(2);
    // the source may go away: the copy stays
    writeFileSync(paths['shot.png']!, 'changed');
    expect((await queueOf(h)).items[0]?.attachments).toHaveLength(2);

    await h.call('queue_remove', { repository: h.repo, item: item.id });
    expect(stored(h)).toEqual([]);
  });

  it('refuses a bad request as a whole', async () => {
    const h = await start();
    const paths = files(h, { 'a.txt': 'a', 'big.bin': Buffer.alloc(21 * 1024 * 1024) });
    const refuse = async (attachments: { path: string; name?: string }[], message: string) => {
      await expect(add(h, 'X', { attachments })).rejects.toThrow(message);
      expect((await queueOf(h)).items).toEqual([]);
      expect(stored(h)).toEqual([]);
    };
    await refuse([{ path: 'a.txt' }], 'must be absolute');
    await refuse([{ path: join(h.state, 'nope.txt') }], 'not readable');
    await refuse([{ path: h.state }], 'not a regular file');
    await refuse([{ path: paths['a.txt']!, name: '../x' }], 'invalid attachment name');
    await refuse([{ path: paths['a.txt']! }, { path: paths['a.txt']! }], 'repeated');
    await refuse([{ path: paths['a.txt']!, name: 'ok' }, { path: paths['big.bin']! }], 'limit');
    const many = Array.from({ length: 11 }, (_, index) => ({
      path: paths['a.txt']!,
      name: `f${index}.txt`,
    }));
    await refuse(many, 'at most 10 attachments');
  });

  it('replaces a file with queue_edit and refuses unknown names', async () => {
    const h = await start();
    const paths = files(h, { 'shot.png': 'old' });
    const view = await add(h, 'A', { attachments: [{ path: paths['shot.png']! }] });
    const id = view.items[0]!.id;
    await expect(
      h.call('queue_edit', { repository: h.repo, item: id, detach: ['nope.txt'] }),
    ).rejects.toThrow('no attachment `nope.txt`');
    writeFileSync(paths['shot.png']!, 'brand new');
    const edited = (await h.call('queue_edit', {
      repository: h.repo,
      item: id,
      detach: ['shot.png'],
      attach: [{ path: paths['shot.png']! }],
    })) as QueueView;
    expect(edited.items[0]?.attachments).toMatchObject([{ fileName: 'shot.png', size: 9 }]);
    expect(stored(h)).toHaveLength(1);
  });
});

describe('attachments of a run', () => {
  it('goes to the run, is read by the specialist from a folder outside the worktree', async () => {
    // no auto delivery: the hidden refs of the run stay for the check
    const h = await start(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    await started(h);
    h.script({ code: [{}] });
    const paths = files(h, { 'shot.png': PNG });
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
      attachments: [{ path: paths['shot.png']! }],
    })) as RunQueued;
    const runId = queued.run!.runId;
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.attachments).toMatchObject([{ fileName: 'shot.png', size: 2048 }]);

    const content = (await h.call('attachment', {
      runId,
      id: final.attachments[0]!.id,
    })) as AttachmentContentView;
    expect(Buffer.from(content.base64, 'base64').equals(PNG)).toBe(true);
    // the item no longer lists them as its own: the run does
    expect(itemById(await queueOf(h), queued.item)).toBeUndefined();

    const call = agentCalls(h)[0]!;
    const message = call.argv[call.argv.indexOf('-p') + 1]!;
    const inWorkspace = message.match(/- (\S+shot\.png) \(2\.0 KB, image\/png\)/)?.[1];
    expect(message).toContain('## Attachments');
    expect(inWorkspace).toBeDefined();
    expect(inWorkspace!.endsWith(`/logs/${runId}/_attachments/shot.png`)).toBe(true);
    expect(readFileSync(inWorkspace!).equals(PNG)).toBe(true);
    expect(call.argv[call.argv.indexOf('--add-dir') + 1]).toBe(
      inWorkspace!.replace('/shot.png', ''),
    );
    // the hidden refs of the run (step commits, group merge) carry no attachment
    const refs = git(h.repo, 'for-each-ref', '--format=%(refname)', `refs/aip/${runId}/`)
      .split('\n')
      .filter(Boolean);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const tree = git(h.repo, 'ls-tree', '-r', '--name-only', ref);
      expect(tree).not.toContain('shot.png');
      expect(tree).not.toContain('_attachments');
    }
    // delivered or not, the file is in no tree: neither in the working tree nor in its changes
    expect(git(h.repo, 'status', '--porcelain', '--untracked-files=all')).not.toContain('shot.png');
    expect(existsSync(join(h.repo, 'shot.png'))).toBe(false);
  });

  it('starts a run without attachments with the usual message and no folder', async () => {
    const h = await start();
    await started(h);
    h.script({ code: [{}] });
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
    })) as RunQueued;
    await h.waitFor(queued.run!.runId, (view) => view.finished);
    const call = agentCalls(h)[0]!;
    expect(call.argv[call.argv.indexOf('-p') + 1]).not.toContain('## Attachments');
    expect(call.argv).not.toContain('--add-dir');
    expect(existsSync(join(h.repo, 'aip', 'logs', queued.run!.runId, '_attachments'))).toBe(false);
  });

  it('keeps the attachments of a returned run and refuses to change them', async () => {
    const h = await start();
    await started(h);
    h.script({ code: [{ noReport: true }, {}] });
    const paths = files(h, { 'shot.png': PNG });
    await add(h, 'A', { attachments: [{ path: paths['shot.png']! }] });
    await h.call('queue_start', { repository: h.repo });
    const stopped = await waitQueue(h, (queue) => queue.stop?.kind === 'problem');
    const runId = (stopped.stop as { run: string }).run;
    const returned = (await h.call('queue_return', { runId })) as QueueView & { item: string };
    expect(itemById(returned, returned.item)?.attachments).toHaveLength(1);
    for (const change of [{ detach: ['shot.png'] }, { attach: [{ path: paths['shot.png']! }] }]) {
      await expect(
        h.call('queue_edit', { repository: h.repo, item: returned.item, ...change }),
      ).rejects.toThrow('a returned run keeps its own attachments');
    }
    expect((await h.status(runId)).attachments).toHaveLength(1);
    expect(stored(h)).toHaveLength(1);
    await h.call('queue_start', { repository: h.repo });
    await h.waitFor(runId, (view) => view.finished);
    expect((await h.status(runId)).attachments).toHaveLength(1);
    expect(agentCalls(h).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the bytes of a run after a restart and sweeps files without a record', async () => {
    const h = await start();
    h.script({ code: [{}] });
    const paths = files(h, { 'shot.png': PNG });
    const queued = (await h.call('run', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'работа',
      attachments: [{ path: paths['shot.png']! }],
    })) as RunQueued;
    const runId = queued.run!.runId;
    const final = await h.waitFor(runId, (view) => view.finished);
    const stray = join(h.state, 'attachments', 'stray');
    await h.restart(() => {
      mkdirSync(stray, { recursive: true });
      writeFileSync(join(stray, 'x'), 'x');
    });
    expect(existsSync(stray)).toBe(false);
    const content = (await h.call('attachment', {
      runId,
      id: final.attachments[0]!.id,
    })) as AttachmentContentView;
    expect(content.size).toBe(2048);
    await expect(h.call('attachment', { runId, id: 'nope' })).rejects.toThrow('unknown attachment');
  });
});
