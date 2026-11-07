import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type ArtifactContentView,
  type ArtifactView,
  type RunCreated,
  type StreamEvent,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';

import { cleanRun } from '../../src/presentation/cli/local/clean.ts';
import type { Context } from '../../src/presentation/cli/context.ts';
import { CODE_ONLY_CONFIG, git, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

interface ToolResult {
  name: string;
  result: { isError?: boolean; content: { text: string }[] };
}

function toolResults(h: Harness): ToolResult[] {
  const file = join(h.fakeState, 'tools.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ToolResult);
}

const publish = (args: Record<string, unknown>) => ({ name: 'swarm_artifact', arguments: args });

async function runWith(h: Harness, action: Record<string, unknown>): Promise<string> {
  h.script({ code: [action] });
  const { runId } = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups: [{ title: 'Вход', task: 'вход' }],
  })) as RunCreated;
  await h.waitFor(runId, (view) => view.finished);
  return runId;
}

const slugOf = async (h: Harness, runId: string) => (await h.status(runId)).groups[0]!.slug;
const list = async (h: Harness, runId: string) =>
  (await h.call('group_artifacts', {
    runId,
    group: await slugOf(h, runId),
  })) as ArtifactView[];
const manual = `${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`;

describe('step artifacts', () => {
  it('publishes content and a worktree file, lists them and returns the bytes', async () => {
    current = await harness(manual);
    const h = current;
    const runId = await runWith(h, {
      write: { 'out/build.log': 'line 1\nline 2\n' },
      toolCalls: [
        publish({ file_name: 'report.md', content: '# Отчёт\n', title: 'Итог' }),
        publish({ file_name: 'build.log', path: 'out/build.log' }),
        publish({ file_name: 'data.zip', content: 'PK' }),
      ],
    });
    const results = toolResults(h);
    expect(results.every((entry) => !entry.result.isError)).toBe(true);
    expect(results[0]?.result.content[0]?.text).toMatch(/^Recorded artifact \S+ \(report\.md\)/);

    const artifacts = await list(h, runId);
    expect(artifacts.map((artifact) => artifact.fileName).sort()).toEqual([
      'build.log',
      'data.zip',
      'report.md',
    ]);
    const report = artifacts.find((artifact) => artifact.fileName === 'report.md')!;
    expect(report).toMatchObject({
      title: 'Итог',
      step: 'code',
      specialist: 'coder',
      seq: 1,
      size: 13,
      preview: 'markdown',
    });
    expect(report.stepName).toBeTruthy();
    expect(artifacts.find((a) => a.fileName === 'build.log')).toMatchObject({
      title: 'build',
      preview: 'log',
    });
    expect(artifacts.find((a) => a.fileName === 'data.zip')?.preview).toBeNull();

    const content = (await h.call('artifact', {
      runId,
      group: await slugOf(h, runId),
      id: report.id,
    })) as ArtifactContentView;
    expect(Buffer.from(content.base64, 'base64').toString('utf8')).toBe('# Отчёт\n');
    expect(content).toMatchObject({ fileName: 'report.md', size: 13 });
    const row = (await h.status(runId)).groups[0];
    expect(row?.artifacts).toBe(3);
  });

  it('replaces an artifact republished in the same attempt', async () => {
    current = await harness(manual);
    const h = current;
    const runId = await runWith(h, {
      toolCalls: [
        publish({ file_name: 'a.md', content: 'one' }),
        publish({ file_name: 'a.md', content: 'second' }),
      ],
    });
    const artifacts = await list(h, runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.size).toBe(6);
    expect(readdirSync(join(h.state, 'artifacts', runId))).toHaveLength(1);
  });

  it('refuses paths outside the worktree, symlinks out of it, .git and big files', async () => {
    current = await harness(manual);
    const h = current;
    const outside = join(h.state, 'secret.txt');
    writeFileSync(outside, 'secret');
    const runId = await runWith(h, {
      write: { 'big.bin': 'x'.repeat(17 * 1024 * 1024), 'dir/inner.txt': 'ok' },
      link: { 'link.txt': outside },
      toolCalls: [
        publish({ file_name: 'a.txt', path: outside }),
        publish({ file_name: 'b.txt', path: '../secret.txt' }),
        publish({ file_name: 'c.txt', path: 'link.txt' }),
        publish({ file_name: 'd.txt', path: '.git' }),
        publish({ file_name: 'e.txt', path: 'dir' }),
        publish({ file_name: 'f.txt', path: 'missing.txt' }),
        publish({ file_name: 'g.bin', path: 'big.bin' }),
        publish({ file_name: 'h.txt', path: 'dir/inner.txt' }),
        publish({ file_name: 'i.txt' }),
      ],
    });
    const results = toolResults(h);
    expect(results.map((entry) => entry.result.isError === true)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(results[0]?.result.content[0]?.text).toContain('outside of the worktree');
    expect(results[6]?.result.content[0]?.text).toContain('larger than');
    expect(results[8]?.result.content[0]?.text).toContain('either content or path');
    const artifacts = await list(h, runId);
    expect(artifacts.map((artifact) => artifact.fileName)).toEqual(['h.txt']);
    expect(readdirSync(join(h.state, 'artifacts', runId))).toHaveLength(1);
  });

  it('refuses the 201st artifact of a group but still replaces an existing one', async () => {
    current = await harness(manual);
    const h = current;
    const calls = Array.from({ length: 200 }, (_, index) =>
      publish({ file_name: `f${index}.txt`, content: 'x' }),
    );
    const runId = await runWith(h, {
      toolCalls: [
        ...calls,
        publish({ file_name: 'extra.txt', content: 'x' }),
        publish({ file_name: 'f0.txt', content: 'replaced' }),
      ],
    });
    const results = toolResults(h);
    expect(results[200]?.result.isError).toBe(true);
    expect(results[200]?.result.content[0]?.text).toContain('at most 200');
    expect(results[201]?.result.isError).toBeFalsy();
    const artifacts = await list(h, runId);
    expect(artifacts).toHaveLength(200);
    expect(artifacts.find((artifact) => artifact.fileName === 'f0.txt')?.size).toBe(8);
    expect(readdirSync(join(h.state, 'artifacts', runId))).toHaveLength(200);
  });

  it('rejects a foreign artifact, an unknown one and one whose bytes are gone', async () => {
    current = await harness(manual);
    const h = current;
    const runId = await runWith(h, {
      toolCalls: [publish({ file_name: 'a.md', content: 'text' })],
    });
    const [artifact] = await list(h, runId);
    await expect(
      h.call('artifact', { runId, group: await slugOf(h, runId), id: 'nope' }),
    ).rejects.toThrow('unknown artifact `nope`');
    await expect(h.call('artifact', { runId, group: 'missing', id: artifact!.id })).rejects.toThrow(
      'unknown group',
    );
    await expect(h.call('group_artifacts', { runId: 'unknown', group: 'Вход' })).rejects.toThrow(
      'unknown run',
    );
    h.running.daemon.database.prepare("UPDATE artifacts SET uri = 's3://bucket/x'").run();
    await expect(
      h.call('artifact', { runId, group: await slugOf(h, runId), id: artifact!.id }),
    ).rejects.toThrow('is not available');
  });

  it('refuses a publication with an unknown or expired token', async () => {
    current = await harness(manual);
    await expect(
      current.call('artifact_publish', { token: 'nope', fileName: 'a.md', content: 'x' }),
    ).rejects.toThrow('unknown or expired report token');
  });

  it('refuses an artifact of another group', async () => {
    current = await harness(manual);
    const h = current;
    h.script({ code: [{ toolCalls: [publish({ file_name: 'a.md', content: 'x' })] }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [
        { title: 'Вход', task: 'вход' },
        { title: 'Выход', task: 'выход' },
      ],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.finished);
    const view = await h.status(runId);
    const [first, second] = view.groups;
    const [artifact] = (await h.call('group_artifacts', {
      runId,
      group: first!.slug,
    })) as ArtifactView[];
    await expect(
      h.call('artifact', { runId, group: second!.slug, id: artifact!.id }),
    ).rejects.toThrow('unknown artifact');
  });

  it('tells subscribers about the new artifact', async () => {
    current = await harness(manual);
    const h = current;
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await runWith(h, { toolCalls: [publish({ file_name: 'a.md', content: 'x' })] });
    await until('the counter', () =>
      events.some(
        (event) =>
          event.event === 'run' &&
          (event.run as unknown as { groups: { artifacts: number }[] }).groups.some(
            (group) => group.artifacts === 1,
          ),
      ),
    );
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });

  it('keeps artifacts after clean, sweeps orphans on start and keeps them out of git', async () => {
    current = await harness(manual);
    const h = current;
    const runId = await runWith(h, {
      write: { 'lib.ts': 'export const value = 3;\n' },
      toolCalls: [publish({ file_name: 'report.md', content: 'UNIQUE-ARTIFACT-TEXT' })],
    });
    const [artifact] = await list(h, runId);
    const full = (await h.status(runId)).id;
    const orphan = join(h.state, 'artifacts', 'r9');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'stray'), 'x');

    const refs = git(h.repo, 'for-each-ref', '--format=%(refname)', `refs/aip/${full}/`);
    for (const ref of refs.split('\n').filter(Boolean)) {
      expect(git(h.repo, 'ls-tree', '-r', '--name-only', ref)).not.toContain('report.md');
    }
    const patch = (await h.call('run_patch', { runId })) as { base64: string };
    expect(Buffer.from(patch.base64, 'base64').toString('utf8')).not.toContain(
      'UNIQUE-ARTIFACT-TEXT',
    );

    await h.call('apply', { runId });
    await cleanRun({ stateDirectory: h.state } as Context, runId, true);
    await h.restart();
    expect(existsSync(orphan)).toBe(false);
    expect(await list(h, runId)).toHaveLength(1);
    const content = (await h.call('artifact', {
      runId,
      group: await slugOf(h, runId),
      id: artifact!.id,
    })) as ArtifactContentView;
    expect(Buffer.from(content.base64, 'base64').toString('utf8')).toBe('UNIQUE-ARTIFACT-TEXT');
  });
});
