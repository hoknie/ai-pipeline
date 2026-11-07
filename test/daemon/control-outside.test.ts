import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath } from '../../src/platform/paths/index.ts';
import { startDaemon } from '../../src/app/index.ts';
import type { RunCreated, Transcript } from '../../src/protocol/index.ts';
import { openStorage } from '../feature/storage.ts';
import { PIPELINE_CONFIG, startRun, statuses, until } from './harness.ts';
import { calls, run, start } from './control-harness.ts';

describe('failures and control', () => {
  it('warns about changes outside the worktree and stops with outside_changes: stop', async () => {
    const warn = await start();
    warn.script({ code: [{ outside: { [join(warn.repo, 'README.md')]: 'stray\n' } }] });
    const warnRun = await run(warn);
    await warn.waitFor(warnRun, (view) => view.finished);
    const warned = await warn.group(warnRun, 'g1');
    expect(warned.warnings).toEqual([]);
    expect(warned.attempts[0]?.outsideChanges).toEqual(['README.md']);
    await warn.close();
    const stop = await start(
      `${PIPELINE_CONFIG}  outside_changes: stop\n`
        .replace('  pipelines:', '  outside_changes: stop\n  pipelines:')
        .replace(/\n  outside_changes: stop\n$/, '\n'),
    );
    stop.script({ code: [{ outside: { [join(stop.repo, 'README.md')]: 'stray\n' } }] });
    const stopRun = await run(stop);
    const waiting = await stop.waitFor(stopRun, (view) => view.groups[0]?.status === 'needs_human');
    expect(waiting.groups[0]?.question).toContain('README.md');
    expect((await stop.group(stopRun, 'g1')).attempts[0]?.outsideChanges).toEqual(['README.md']);
  });

  it('does not count a delivery of another run as a change outside the worktree', async () => {
    const h = await start();
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    h.script({
      code: [{ outside: { [join(h.repo, 'README.md')]: 'stray\n' }, waitFor: h.gate('first') }],
    });
    const first = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'first', task: 'one' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(first, (view) => view.groups[0]?.status === 'running');
    // the first agent has read its script once it wrote the stray file
    await until('the stray file', () => existsSync(join(h.repo, 'README.md')));
    expect((await h.group(first, 'first')).status).toBe('running');
    h.script({ code: [{ write: { 'shared.md': 'from b\n' } }] });
    const second = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'second', task: 'two' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(second, (view) => view.finished);
    await until('the delivery of the second run', () => existsSync(join(h.repo, 'shared.md')));
    expect(readFileSync(join(h.repo, 'shared.md'), 'utf8')).toBe('from b\n');
    // the delivery came while the first step was still running
    expect((await h.group(first, 'first')).status).toBe('running');
    h.open('first');
    await h.waitFor(first, (view) => view.finished);
    expect((await h.group(first, 'first')).attempts[0]?.outsideChanges).toEqual(['README.md']);
  });

  it('keeps an outside change of a file that another run delivers to a branch', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace(
        '  pipelines:',
        '  delivery: { mode: branch, auto: true }\n  pipelines:',
      ),
    );
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    h.script({
      code: [{ outside: { [join(h.repo, 'README.md')]: 'stray\n' }, waitFor: h.gate('first') }],
    });
    const first = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'first', task: 'one' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(first, (view) => view.groups[0]?.status === 'running');
    await until('the stray file', () => existsSync(join(h.repo, 'README.md')));
    h.script({ code: [{ write: { 'README.md': 'from b\n' } }] });
    const second = (
      (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title: 'second', task: 'two' }],
      })) as RunCreated
    ).runId;
    await h.waitFor(second, (view) => view.finished);
    expect((await h.group(first, 'first')).status).toBe('running');
    h.open('first');
    await h.waitFor(first, (view) => view.finished);
    expect((await h.group(first, 'first')).attempts[0]?.outsideChanges).toEqual(['README.md']);
  });

  it('fails a step whose runtime is not installed', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace(
        'coder: { name: Кодировщик }',
        'coder: { name: Кодировщик, runtime: opencode }',
      ),
      {
        AIP_OPENCODE_BIN: '/nonexistent/opencode',
      },
    );
    const runId = await run(h);
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]).toMatchObject({
      status: 'failed',
      reason: 'runtime not found: opencode',
    });
  });

  it('runs a specialist through the opencode runtime', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace(
        'coder: { name: Кодировщик }',
        'coder: { name: Кодировщик, runtime: opencode, model: x/y }',
      ),
    );
    const runId = await run(h);
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const code = calls(h).find((call) => call.step === 'code');
    expect(code?.args.slice(0, 3)).toEqual(['run', '--format', 'json']);
    expect((await h.group(runId, 'g1')).attempts[0]?.usage).toEqual({
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0.002,
    });
  });

  it('splits a task into groups before the steps', async () => {
    const h = await start(
      PIPELINE_CONFIG.replace(
        '    feature:\n      steps:',
        '    feature:\n      split: { specialist: coder, max_groups: 3 }\n      steps:',
      ),
    );
    h.script({
      split: [
        {
          split: [
            { title: 'Вход', task: 'вход' },
            { title: 'Выход', task: 'выход' },
          ],
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'вход и выход',
    })) as RunCreated;
    expect(created.split).toBe(true);
    const final = await h.waitFor(created.runId, (view) => view.finished);
    expect(final.split?.status).toBe('done');
    expect(final.groups.map((group) => [group.slug, group.status])).toEqual([
      ['vhod', 'merged'],
      ['vyhod', 'merged'],
    ]);
  });

  it('runs the groups of a split through the steps of another pipeline', async () => {
    const h = await start(`swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
    reviewer: { name: Ревьюер, permissions: read }
  pipelines:
    explore:
      steps:
        - { id: research, specialist: reviewer }
        - { id: write, specialist: coder }
    epic:
      split: { specialist: coder, pipeline: explore }
`);
    h.script({
      split: [
        {
          split: [
            { title: 'Вход', task: 'вход' },
            { title: 'Выход', task: 'выход' },
          ],
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'epic',
      task: 'вход и выход',
    })) as RunCreated;
    const final = await h.waitFor(created.runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged', 'merged']);
    const detail = await h.group(created.runId, 'vhod');
    expect(detail.attempts.map((attempt) => [attempt.stepId, attempt.specialist])).toEqual([
      ['research', 'reviewer'],
      ['write', 'coder'],
    ]);
  });

  it('retries a group of a run stored with the old names through the steps of the target', async () => {
    const h = await start(`swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
    reviewer: { name: Ревьюер, permissions: read }
  pipelines:
    explore:
      steps:
        - { id: research, specialist: reviewer }
        - { id: write, specialist: coder }
    epic:
      split: { specialist: coder, pipeline: explore }
`);
    h.script({
      split: [{ split: [{ title: 'Вход', task: 'вход' }] }],
      write: [{ exitCode: 1, noReport: true }],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'epic',
      task: 'вход',
    })) as RunCreated;
    await h.waitFor(created.runId, (view) => view.groups[0]?.status === 'failed');
    await h.restart(() => {
      // The snapshot as an older build stored it: `workflows` and `split.workflow`.
      const store = openStorage(databasePath(h.state));
      const state = store.runs.loadRun(created.runId)!;
      const { pipelines, ...rest } = state.run.config as unknown as Record<string, unknown>;
      const old = (pipelines as { split?: { pipeline?: string } }[]).map((pipeline) => {
        if (!pipeline.split) return pipeline;
        const { pipeline: target, ...split } = pipeline.split;
        return { ...pipeline, split: { ...split, workflow: target } };
      });
      state.run.config = { ...rest, workflows: old } as unknown as typeof state.run.config;
      store.runs.saveRun(state);
      store.database.close();
    });
    h.script({ split: [{ split: [{ title: 'Вход', task: 'вход' }] }], write: [{}] });
    await h.call('retry', { runId: created.runId, group: 'vhod' });
    const final = await h.waitFor(created.runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const detail = await h.group(created.runId, 'vhod');
    expect(detail.attempts.map((attempt) => attempt.stepId)).toContain('write');
  });

  it('marks running steps interrupted after a restart and keeps the queue', async () => {
    const h = await start(PIPELINE_CONFIG.replace('max: 3', 'max: 1'));
    h.script({ code: [{ hang: true }, {}] });
    const runId = await run(h, 2);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    h.script({ code: [{}] });
    await h.restart();
    const final = await h.waitFor(runId, (view) => view.groups[1]?.status === 'merged');
    expect(final.groups[0]).toMatchObject({ status: 'failed', reason: 'interrupted' });
  });

  it('refuses a second daemon on the same state directory', async () => {
    const h = await start();
    const other = join(h.fakeState, 'other-state');
    mkdirSync(other, { recursive: true });
    const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
    writeFileSync(join(other, 'aip.pid'), String(holder.pid));
    try {
      const started = startDaemon({
        stateDirectory: other,
        entry: [process.execPath, 'x'],
        environment: h.environment,
      });
      await expect(started).rejects.toThrow('already running');
      await started.then((daemon) => daemon.close()).catch(() => undefined);
    } finally {
      holder.kill();
    }
  });
});

describe('transcripts', () => {
  it('reads the log of a running attempt incrementally and of each attempt by seq', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    let running = (await h.call('transcript', { runId, group: 'vhod' })) as Transcript;
    await until('the attempt started', async () => {
      running = (await h.call('transcript', { runId, group: 'vhod' })) as Transcript;
      return running.seq !== null;
    });
    expect(running).toMatchObject({ seq: 1, running: true, entries: [] });
    h.open('code');
    await h.waitFor(runId, (view) => view.finished);
    const done = (await h.call('transcript', {
      runId,
      group: 'vhod',
      seq: 1,
      after: running.cursor,
    })) as Transcript;
    expect(done.running).toBe(false);
    expect(done.entries).toContainEqual(
      expect.objectContaining({ kind: 'result', verdict: 'done', outputTokens: 20 }),
    );
    await expect(h.call('transcript', { runId, group: 'vhod', seq: 9 })).rejects.toThrow(
      'unknown attempt 9',
    );
  });
});

describe('pipelines view', () => {
  it('names the file of a syntax error in aip/settings.yaml', async () => {
    const h = await start();
    const file = join(h.repo, 'aip', 'settings.yaml');
    writeFileSync(file, 'max: [\n');
    const view = (await h.call('pipelines', { repository: h.repo })) as {
      pipelines: unknown[];
      errors: { file?: string; path: string; message: string }[];
    };
    expect(view.pipelines).toEqual([]);
    expect(view.errors).toEqual([{ path: file, message: expect.stringContaining(file) }]);
  });

  it('gives a validation error the file it comes from', async () => {
    const h = await start();
    const file = join(h.repo, 'aip', 'settings.yaml');
    writeFileSync(file, 'max: 0\n');
    const view = (await h.call('pipelines', { repository: h.repo })) as {
      errors: { file?: string; path: string }[];
    };
    expect(view.errors).toContainEqual(expect.objectContaining({ file, path: 'swarm.max' }));
  });
});
