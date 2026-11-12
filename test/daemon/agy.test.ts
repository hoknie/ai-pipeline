import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_ONLY_CONFIG } from './harness.ts';
import { calls, run, start } from './control-harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';

export const AGY_CONFIG = CODE_ONLY_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: C, runtime: agy }',
);

describe('agy execution', () => {
  it('runs the fake CLI and reports through the real worker MCP server', async () => {
    const h = await start(AGY_CONFIG);
    h.script({ code: [{ realWorker: true, write: { 'agy.ts': 'export const ready = true;\n' } }] });
    const id = await run(h);
    const view = await h.waitFor(id, (value) => value.finished);
    expect(view.groups[0]?.status).toBe('merged');
    const attempt = (await h.group(id, 'g1')).attempts[0]!;
    expect(attempt.runtime).toBe('agy');
    expect(attempt.usage).toEqual({ inputTokens: 100, outputTokens: 20, costUsd: null });
    expect(calls(h)[0]?.args).toContain('stream-json');
    expect(readFileSync(join(h.fakeState, 'worker.jsonl'), 'utf8')).toContain('"via":"mcp"');
  });

  it('does not accept a successful process instead of a report', async () => {
    const h = await start(AGY_CONFIG);
    h.script({ code: [{ noReport: true }] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    expect((await h.group(id, 'g1')).attempts[0]?.reason).toBe('no report');
  });

  it('continues the conversation but rotates the attempt worker after a human answer', async () => {
    const h = await start(AGY_CONFIG);
    h.script({ code: [{ verdict: 'needs_human', feedback: 'Continue?' }, { realWorker: true }] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'needs_human');
    await h.restart();
    await h.call('answer', { runId: id, group: 'g1', answer: 'Continue' });
    await h.waitFor(id, (value) => value.finished);
    const launched = calls(h).filter((item) => item.step === 'code');
    expect(launched[1]?.args.slice(-2)).toEqual(['--conversation', 'conv_fake']);
    expect(launched[0]?.workerServer).not.toBe(launched[1]?.workerServer);
  });

  it('keeps ordinary retry snapshots and refreshes runtime settings after daemon restart', async () => {
    const oldConfig = AGY_CONFIG.replace('runtime: agy', 'runtime: agy, model: old-model');
    const h = await start(oldConfig);
    h.script({ code: [{ noReport: true, exitCode: 1 }, { noReport: true, exitCode: 1 }, {}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    await h.call('retry', { runId: id, group: 'g1' });
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    const newConfig = oldConfig.replace('old-model', 'new-model');
    writeConfigDirectory(h.repo, newConfig);
    await h.restart();
    await h.call('retry', { runId: id, group: 'g1', refreshConfig: true });
    await h.waitFor(id, (value) => value.finished);
    const launches = calls(h).filter((item) => item.step === 'code');
    expect(launches).toHaveLength(3);
    expect(launches[0]?.args).toContain('old-model');
    expect(launches[1]?.args).toContain('old-model');
    expect(launches[2]?.args).toContain('new-model');
    expect(launches.slice(1).map((item) => item.args.includes('--conversation'))).toEqual([
      false,
      false,
    ]);
    expect(new Set(launches.map((item) => item.workerServer)).size).toBe(3);
  });

  it('uses the worker to publish artifacts and add queue tasks when permitted', async () => {
    const h = await start(AGY_CONFIG.replace('runtime: agy }', 'runtime: agy, queue: true }'));
    h.script({
      code: [
        {
          toolCalls: [
            { name: 'swarm_artifact', arguments: { file_name: 'report.md', content: '# Review' } },
          ],
          queue: { pipeline: 'feature', task: 'follow-up' },
        },
      ],
    });
    const id = await run(h);
    await h.waitFor(id, (value) => value.finished);
    const group = (await h.status(id)).groups[0]!;
    const artifacts = (await h.call('group_artifacts', { runId: id, group: group.slug })) as {
      fileName: string;
    }[];
    expect(artifacts.map((artifact) => artifact.fileName)).toContain('report.md');
    const queue = await h.call('queue', { repository: h.repo });
    expect(JSON.stringify(queue)).toContain('follow-up');
  });

  it('respects timeout and cancel and fails a missing agy command rather than falling back', async () => {
    const timeoutConfig = AGY_CONFIG.replace('runtime: agy', 'runtime: agy, timeout: 1s');
    const timeout = await start(timeoutConfig);
    timeout.script({ code: [{ hang: true }] });
    const timed = await run(timeout);
    await timeout.waitFor(timed, (value) => value.finished);
    expect((await timeout.status(timed)).groups[0]?.reason).toBe('timeout');

    const missing = await start(AGY_CONFIG, { AIP_AGY_BIN: '/missing/agy' });
    const absent = await run(missing);
    await missing.waitFor(absent, (value) => value.finished);
    expect((await missing.status(absent)).groups[0]?.reason).toContain('runtime not found: agy');

    const cancelled = await start(AGY_CONFIG);
    cancelled.script({ code: [{ hang: true }] });
    const id = await run(cancelled);
    await cancelled.waitFor(id, (value) => value.groups[0]?.status === 'running');
    await cancelled.call('cancel', { runId: id });
    expect((await cancelled.waitFor(id, (value) => value.finished)).groups[0]?.status).toBe(
      'cancelled',
    );
  });

  it('runs Antigravity and Claude in the same pipeline', async () => {
    const config = AGY_CONFIG.replace(
      '- { id: code, specialist: coder }',
      '- { id: code, specialist: coder }\n        - { id: review, specialist: reviewer }',
    );
    const h = await start(config);
    h.script({ code: [{}], review: [{}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.finished);
    expect(calls(h).map((item) => item.mode)).toEqual(['agy', 'claude']);
  });

  it('uses agy naming when it succeeds and does not fail a run when naming fails', async () => {
    const config = AGY_CONFIG.replace(
      '  max: 3',
      '  max: 3\n  naming: { runtime: agy, model: title-model }',
    );
    const h = await start(config);
    h.script({ naming: { answer: '{"title":"Login","name":"login"}' }, code: [{}] });
    const id = await run(h);
    const named = await h.waitFor(id, (value) => value.finished && value.title === 'Login');
    expect(named.name).toBe('login');
    expect(readFileSync(join(h.fakeState, 'oneshots.jsonl'), 'utf8')).toContain('title-model');

    const failed = await start(config);
    failed.script({ code: [{}] });
    const fallback = await run(failed);
    const completed = await failed.waitFor(fallback, (value) => value.finished);
    expect(completed.title).not.toBe('Login');
  });

  it('rereads the shared agy command and arguments without restarting the daemon', async () => {
    const h = await start(AGY_CONFIG, { AIP_AGY_BIN: '' });
    const shared = join(h.environment.XDG_CONFIG_HOME!, 'aip');
    mkdirSync(shared, { recursive: true });
    const fakeCommand = join(import.meta.dirname, '..', 'fakes', 'agy');
    writeFileSync(
      join(shared, 'settings.yaml'),
      `runtimes:\n  agy:\n    enabled: true\n    command: ${fakeCommand}\n    args: [--effort, low]\n`,
    );
    const first = await run(h);
    await h.waitFor(first, (value) => value.finished);
    writeFileSync(
      join(shared, 'settings.yaml'),
      'runtimes:\n  agy:\n    enabled: true\n    command: /missing/agy\n    args: [--effort, high]\n',
    );
    const second = await run(h);
    await h.waitFor(second, (value) => value.finished);
    const launches = calls(h).filter((item) => item.step === 'code');
    expect(launches[0]?.args.slice(0, 2)).toEqual(['--effort', 'low']);
    expect((await h.status(second)).groups[0]?.reason).toContain('runtime not found: agy');
    expect(h.running.application.socket).toBe(h.socket);
  });
});
