import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunCreated } from '../../src/presentation/ipc/contract/index.ts';
import { databasePath } from '../../src/platform/paths/index.ts';
import { openStorage } from '../feature/storage.ts';
import { run as seedRun } from '../feature/runs/helpers.ts';
import { runTitle } from '../../src/feature/runs/types/index.ts';
import type { EffectDependencies } from '../../src/feature/runs/services/effects/context.ts';
import type { RunningAgents } from '../../src/feature/runs/services/effects/running.ts';
import { nameRun } from '../../src/feature/runs/services/effects/naming.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';
import { git, harness, startRun, type Harness, until } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

describe('qualified model identity in daemon runs', () => {
  it('skips a stale invalid naming model without starting a one-shot process', async () => {
    const state = seedRun(1);
    state.run.config.naming = { enabled: true, runtime: 'opencode', model: 'gpt-short' };
    const runtimeFor = vi.fn();
    const dependencies = {
      config: { runtimeSettings: vi.fn() },
      agents: { runtimeFor },
    } as unknown as EffectDependencies;
    await nameRun(dependencies, {} as RunningAgents, state);
    expect(runtimeFor).not.toHaveBeenCalled();
    expect(state.run.title).toBeNull();
    expect(state.run.name).toBeNull();
    expect(runTitle(state)).toBe('задача 1');
  });

  it('keeps a full OpenCode ID in the attempt snapshot and fake-agent argv', async () => {
    const model = 'MyProvider/team/GPT-Custom';
    const config = `swarm:
  specialists:
    coder: { name: Coder, runtime: opencode, model: ${model} }
    chained: { name: Chained, runtime_chain: qualified }
  chains:
    qualified:
      name: Qualified
      mode: on_error
      runtimes:
        - runtime: opencode
          model: OtherProvider/team/GPT-Custom
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: chain, specialist: chained }
`;
    const h = (current = await harness(config));
    h.script({ code: [{}], chain: [{}] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'test model identity',
    })) as RunCreated;
    const final = await h.waitFor(created.runId, (run) => run.finished);
    expect(final.groups[0]?.status).toBe('merged');
    const detail = await h.group(created.runId, final.groups[0]!.slug);
    expect(detail.attempts.map((attempt) => attempt.model)).toEqual([
      model,
      'OtherProvider/team/GPT-Custom',
    ]);
    const calls = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[] });
    const models = calls
      .map((call) => call.args.slice(call.args.indexOf('-m'), call.args.indexOf('-m') + 2))
      .filter((args) => args[0] === '-m');
    expect(models).toEqual([
      ['-m', model],
      ['-m', 'OtherProvider/team/GPT-Custom'],
    ]);
    await h.restart();
    const afterRestart = await h.group(created.runId, final.groups[0]!.slug);
    expect(afterRestart.attempts.map((attempt) => attempt.model)).toEqual([
      model,
      'OtherProvider/team/GPT-Custom',
    ]);
  });

  it('refuses to launch a retry seeded with an old short-model snapshot', async () => {
    const validConfig = `swarm:
  specialists:
    coder: { name: Coder, runtime: opencode, model: openai/gpt-good }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;
    const h = (current = await harness(validConfig));
    h.script({ code: [{}] });
    const snapshot = seedRun(1, { id: 'legacy-model-run', configText: validConfig });
    snapshot.run.repository = h.repo;
    snapshot.run.config.specialists[0]!.model = 'gpt-short';
    const group = snapshot.groups[0]!;
    group.status = 'failed';
    group.reason = 'previous failure';
    group.attempts = [
      {
        seq: 1,
        stepId: 'code',
        stepIndex: 0,
        round: 1,
        specialist: 'coder',
        runtime: 'opencode',
        model: 'gpt-historical',
        status: 'failed',
        input: {
          prompt: 'test',
          groupTitle: 'Группа 1',
          stepId: 'code',
          specialistName: 'Coder',
          skills: [],
          previous: [],
          feedback: null,
          humanAnswer: null,
          decisions: [],
        },
        resumeSession: null,
        sessionId: null,
        report: null,
        reason: { kind: 'no_report' },
        startedAt: 1000,
        finishedAt: 1010,
        usage: null,
        proposal: null,
        denials: [],
        outsideChanges: [],
      },
    ];
    snapshot.run.finishedAt = null;
    await h.restart(() => {
      const storage = openStorage(databasePath(h.state));
      storage.runs.saveRun(snapshot);
      storage.database.close();
      git(h.repo, 'update-ref', `refs/aip/${snapshot.run.id}/run`, 'HEAD');
    });

    const stored = await h.group(snapshot.run.id, group.slug);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]?.model).toBe('gpt-historical');
    await h.call('retry', { runId: snapshot.run.id, group: group.slug });
    const final = await h.waitFor(snapshot.run.id, (run) => run.groups[0]?.status === 'failed');
    expect(final.groups[0]?.reason).toContain('spawn error:');
    expect(final.groups[0]?.reason).toContain('gpt-short');
    expect(final.groups[0]?.reason).toContain('provider/model');
    expect(final.groups[0]?.reason).not.toContain('no report');
    const failedAttempt = await h.group(snapshot.run.id, group.slug);
    expect(failedAttempt.attempts[1]?.model).toBe('gpt-short');
    expect(existsSync(join(h.fakeState, 'calls.jsonl'))).toBe(false);

    writeConfigDirectory(h.repo, validConfig);
    await h.call('retry', { runId: snapshot.run.id, group: group.slug });
    await until('the plain retry attempt to be stored', async () => {
      return (await h.group(snapshot.run.id, group.slug)).attempts.length === 3;
    });
    const plainRetry = await h.waitFor(
      snapshot.run.id,
      (run) => run.groups[0]?.status === 'failed',
    );
    expect(plainRetry.groups[0]?.reason).toContain('gpt-short');
    expect(
      (await h.group(snapshot.run.id, group.slug)).attempts.map((attempt) => attempt.model),
    ).toEqual(['gpt-historical', 'gpt-short', 'gpt-short']);

    await h.call('retry', { runId: snapshot.run.id, group: group.slug, refreshConfig: true });
    await until('the refreshed retry attempt to be stored', async () => {
      return (await h.group(snapshot.run.id, group.slug)).attempts.length === 4;
    });
    await until('the refreshed agent call', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    const attempts = (await h.group(snapshot.run.id, group.slug)).attempts;
    expect(attempts.map((attempt) => attempt.model)).toEqual([
      'gpt-historical',
      'gpt-short',
      'gpt-short',
      'openai/gpt-good',
    ]);
    const calls = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[] });
    expect(
      calls.some(
        (call) =>
          call.args.slice(call.args.indexOf('-m'), call.args.indexOf('-m') + 2).join(' ') ===
          '-m openai/gpt-good',
      ),
    ).toBe(true);
  });

  it('falls back to the next runtime on spawn error for an old short-model chain', async () => {
    const validConfig = `swarm:
  specialists:
    chained: { name: Chained, runtime_chain: qualified }
  chains:
    qualified:
      name: Qualified
      mode: on_error
      runtimes:
        - runtime: opencode
          model: openai/gpt-first
        - runtime: opencode
          model: openai/gpt-second
  pipelines:
    feature:
      steps:
        - { id: chain, specialist: chained }
`;
    const h = (current = await harness(validConfig));
    h.script({ chain: [{}] });
    const snapshot = seedRun(1, { id: 'legacy-chain-run', configText: validConfig });
    snapshot.run.repository = h.repo;
    snapshot.run.config.chains[0]!.runtimes[0]!.model = 'gpt-short';
    const group = snapshot.groups[0]!;
    group.status = 'failed';
    group.reason = 'previous failure';
    snapshot.run.finishedAt = null;
    await h.restart(() => {
      const storage = openStorage(databasePath(h.state));
      storage.runs.saveRun(snapshot);
      storage.database.close();
      git(h.repo, 'update-ref', `refs/aip/${snapshot.run.id}/run`, 'HEAD');
    });

    await h.call('retry', { runId: snapshot.run.id, group: group.slug });
    const final = await h.waitFor(snapshot.run.id, (run) => run.finished);
    expect(final.groups[0]?.status).toBe('merged');
    const detail = await h.group(snapshot.run.id, group.slug);
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts[0]?.model).toBe('gpt-short');
    expect(detail.attempts[0]?.status).toBe('failed');
    expect(detail.attempts[0]?.reason).toContain('spawn error:');
    expect(detail.attempts[0]?.reason).toContain('provider/model');
    expect(detail.attempts[1]?.model).toBe('openai/gpt-second');
    expect(detail.attempts[1]?.status).toBe('finished');
    const calls = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { args: string[] });
    const models = calls
      .map((call) => call.args.slice(call.args.indexOf('-m'), call.args.indexOf('-m') + 2))
      .filter((args) => args[0] === '-m');
    expect(models).toEqual([['-m', 'openai/gpt-second']]);
  });
});
