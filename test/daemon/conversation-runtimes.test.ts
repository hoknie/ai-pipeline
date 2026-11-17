import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODE_ONLY_CONFIG } from './harness.ts';
import { run, start } from './control-harness.ts';

const RUNTIMES = ['codex', 'kilo', 'cline', 'copilot'] as const;

const configFor = (runtime: string, extra = '') =>
  CODE_ONLY_CONFIG.replace(
    'coder: { name: Coder }',
    `coder: { name: C, runtime: ${runtime}${extra} }`,
  );

interface Call {
  mode: string;
  step: string;
  group: string;
  args: string[];
  resume: string | null;
  sessionId: string;
  historyBefore: number;
  historyFile: string;
  workerToken: string | null;
  serverNames: string[];
  home: string | null;
  worker: { command: string; args: string[] } | null;
}

const callsOf = (fakeState: string): Call[] =>
  readFileSync(join(fakeState, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Call);

describe.each(RUNTIMES)('%s execution', (runtime) => {
  it('runs the fake CLI and reports through the real worker MCP server', async () => {
    const h = await start(configFor(runtime));
    h.script({ code: [{ realWorker: true, write: { 'out.ts': 'export const ready = true;\n' } }] });
    const id = await run(h);
    const view = await h.waitFor(id, (value) => value.finished);
    expect(view.groups[0]?.status).toBe('merged');
    const attempt = (await h.group(id, 'g1')).attempts[0]!;
    expect(attempt.runtime).toBe(runtime);
    expect(attempt.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(readFileSync(join(h.fakeState, 'worker.jsonl'), 'utf8')).toContain('"via":"mcp"');
    // the CLI ran in the worktree, never in the repository of the user
    expect(callsOf(h.fakeState)[0]?.worker?.args).toContain('--worker');
  });

  it('does not accept a successful process instead of a report', async () => {
    const h = await start(configFor(runtime));
    h.script({ code: [{ noReport: true }] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    expect((await h.group(id, 'g1')).attempts[0]?.reason).toBe('no report');
  });

  it('resumes the stored conversation from the state on disk after a restart of the daemon', async () => {
    const h = await start(configFor(runtime));
    h.script({ code: [{ verdict: 'needs_human', feedback: 'Continue?' }, {}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'needs_human');
    // a conversation that waits for a person keeps its state
    expect(existsSync(callsOf(h.fakeState)[0]!.historyFile)).toBe(true);
    await h.restart();
    await h.call('answer', { runId: id, group: 'g1', answer: 'Continue' });
    await h.waitFor(id, (value) => value.finished);
    const [first, second] = callsOf(h.fakeState);
    expect(second?.resume).toBe(first?.sessionId);
    expect(second?.sessionId).toBe(first?.sessionId);
    // the fake read the real history file the first process wrote
    expect(second?.historyBefore).toBe(1);
    expect(second?.home).toBe(first?.home);
    // the worker of the first attempt is gone: a new token, a new server name
    expect(second?.workerToken).not.toBe(first?.workerToken);
    expect(second?.serverNames).not.toEqual(first?.serverNames);
    expect(second?.serverNames).toHaveLength(1);
  });

  it('rejects the token of an earlier attempt', async () => {
    const h = await start(configFor(runtime));
    h.script({ code: [{ verdict: 'needs_human', feedback: 'Continue?' }, {}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'needs_human');
    const stale = callsOf(h.fakeState)[0]!.workerToken!;
    await h.call('answer', { runId: id, group: 'g1', answer: 'Continue' });
    await h.waitFor(id, (value) => value.finished);
    await expect(
      h.call('report', { token: stale, verdict: 'done', summary: 'late', feedback: null }),
    ).rejects.toThrow();
  });

  it('starts a retry in a new, empty conversation state', async () => {
    const h = await start(configFor(runtime));
    h.script({ code: [{ noReport: true, exitCode: 1 }, {}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    await h.call('retry', { runId: id, group: 'g1' });
    await h.waitFor(id, (value) => value.finished);
    const [first, second] = callsOf(h.fakeState);
    expect(second?.resume).toBeNull();
    expect(second?.historyBefore).toBe(0);
    expect(second?.home).not.toBe(first?.home);
    expect(second?.sessionId).not.toBe(first?.sessionId);
  });

  it('gives parallel groups their own states', async () => {
    const h = await start(configFor(runtime));
    h.script({ code: [{}] });
    const id = await run(h, 2);
    await h.waitFor(id, (value) => value.finished);
    const calls = callsOf(h.fakeState);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.home).not.toBe(calls[1]?.home);
    expect(calls[0]?.workerToken).not.toBe(calls[1]?.workerToken);
  });
});

describe('conversation guarantees of copilot', () => {
  it('fails a resumed attempt whose stream names another session and keeps the stored id', async () => {
    const h = await start(configFor('copilot'));
    h.script({
      code: [{ verdict: 'needs_human', feedback: 'Continue?' }, { wrongId: 'foreign' }, {}],
    });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'needs_human');
    const stored = callsOf(h.fakeState)[0]!.sessionId;
    await h.call('answer', { runId: id, group: 'g1', answer: 'Continue' });
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    const attempts = (await h.group(id, 'g1')).attempts;
    const second = attempts[1]!;
    expect(second.status).not.toBe('finished');
    expect(second.reason).toMatch(/not the stored conversation/);
    const state = h.running.application.services.runs.states.get(id);
    expect(state.groups[0]?.attempts[1]?.sessionId).toBe(stored);
  });

  it('removes the conversations of a group after it is merged, a human review included', async () => {
    const config = configFor('codex').replace(
      '- { id: code, specialist: coder }',
      '- { id: code, specialist: coder, human_review: true }',
    );
    const h = await start(config);
    h.script({ code: [{}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'needs_human');
    const file = callsOf(h.fakeState)[0]!.historyFile;
    expect(existsSync(file)).toBe(true);
    await h.call('answer', { runId: id, group: 'g1', answer: 'ok' });
    await h.waitFor(id, (value) => value.finished);
    const { until } = await import('./control-harness.ts');
    const home = callsOf(h.fakeState)[0]!.home!;
    await until('the conversation is removed', () => !existsSync(file) && !existsSync(home));
  });
});

describe('conversations of two steps of one specialist', () => {
  it('keeps separate profiles and removes the state of a finished step only', async () => {
    const config = configFor('codex').replace(
      '- { id: code, specialist: coder }',
      '- { id: code, specialist: coder }\n        - { id: code2, specialist: coder }',
    );
    const h = await start(config);
    const hold = h.gate('second');
    h.script({ code: [{}], code2: [{ waitFor: hold }] });
    const id = await run(h);
    const { until } = await import('./control-harness.ts');
    await until('the second step', () => {
      try {
        return callsOf(h.fakeState).some((call) => call.step === 'code2');
      } catch {
        return false;
      }
    });
    const [first, second] = callsOf(h.fakeState);
    expect(second?.home).not.toBe(first?.home);
    expect(existsSync(first!.historyFile)).toBe(false);
    expect(existsSync(second!.historyFile)).toBe(true);
    h.open('second');
    await h.waitFor(id, (value) => value.finished);
  });
});

describe('a chain from Codex to Copilot', () => {
  it('does not carry the id or the profile of the first CLI over to the second', async () => {
    const config = `swarm:
  max: 3
  specialists:
    coder: { name: Coder, runtime_chain: pair }
  chains:
    pair:
      name: Pair
      mode: on_error
      runtimes:
        - { runtime: codex }
        - { runtime: copilot, model: backup }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
`;
    const h = await start(config);
    h.script({ code: [{ noReport: true, exitCode: 1 }, {}] });
    const id = await run(h);
    const view = await h.waitFor(id, (value) => value.finished);
    const attempts = (await h.group(id, 'g1')).attempts;
    expect(view.groups[0]?.status).toBe('merged');
    expect(attempts.map((attempt) => attempt.runtime)).toEqual(['codex', 'copilot']);
    const [first, second] = callsOf(h.fakeState);
    expect(second?.mode).toBe('copilot');
    expect(second?.resume).toBeNull();
    expect(second?.historyBefore).toBe(0);
    expect(second?.home).not.toBe(first?.home);
    expect(second?.sessionId).not.toBe(first?.sessionId);
  });
});

describe('the four CLIs next to the old ones', () => {
  it('runs a mixed pipeline of Claude and Copilot, and a chain on_error past a disabled runtime', async () => {
    const config = `swarm:
  max: 3
  specialists:
    coder: { name: Coder, runtime: copilot }
    reviewer: { name: Reviewer, permissions: read }
    chained: { name: Chained, runtime_chain: skip }
  chains:
    skip:
      name: Skip
      mode: on_error
      runtimes:
        - { runtime: kilo, model: m }
        - { runtime: codex }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer }
        - { id: chain, specialist: chained }
`;
    // Kilo is off: the chain moves on to Codex
    const h = await start(config, { AIP_KILO_BIN: '' });
    h.script({ code: [{}], review: [{}], chain: [{}] });
    const id = await run(h);
    const view = await h.waitFor(id, (value) => value.finished);
    expect(view.groups[0]?.status).toBe('merged');
    const attempts = (await h.group(id, 'g1')).attempts.map((attempt) => [
      attempt.runtime,
      attempt.reason,
    ]);
    expect(attempts).toEqual([
      ['copilot', null],
      ['claude', null],
      ['kilo', 'runtime disabled: kilo'],
      ['codex', null],
    ]);
  });

  it('fails a step on a disabled runtime instead of falling back, and never touches a real API', async () => {
    const h = await start(configFor('cline'), { AIP_CLINE_BIN: '' });
    const id = await run(h);
    await h.waitFor(id, (value) => value.finished);
    expect((await h.status(id)).groups[0]?.reason).toBe('runtime disabled: cline');
    expect(existsSync(join(h.fakeState, 'calls.jsonl'))).toBe(false);
  });

  it('keeps the snapshot on a retry and takes the new model with refresh_config', async () => {
    const config = configFor('codex', ', model: old-model');
    const h = await start(config);
    h.script({ code: [{ noReport: true, exitCode: 1 }, { noReport: true, exitCode: 1 }, {}] });
    const id = await run(h);
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    await h.call('retry', { runId: id, group: 'g1' });
    await h.waitFor(id, (value) => value.groups[0]?.status === 'failed');
    const { writeConfigDirectory } = await import('../fixtures/config.ts');
    writeConfigDirectory(h.repo, config.replace('old-model', 'new-model'));
    await h.restart();
    await h.call('retry', { runId: id, group: 'g1', refreshConfig: true });
    await h.waitFor(id, (value) => value.finished);
    const models = callsOf(h.fakeState).map(
      (call) =>
        readFileSync(join(call.home!, 'config.toml'), 'utf8').match(/^model = "(.+)"$/m)?.[1],
    );
    // the config file of the private home is rewritten on every attempt: the last one is the new model
    expect(models.at(-1)).toBe('new-model');
    expect(callsOf(h.fakeState)).toHaveLength(3);
  });

  it('names a run through a one-shot question of a new CLI', async () => {
    const config = configFor('codex').replace(
      '  max: 3',
      '  max: 3\n  naming: { runtime: codex, model: title-model }',
    );
    const h = await start(config);
    h.script({ naming: { answer: '{"title":"Login","name":"login"}' }, code: [{}] });
    const id = await run(h);
    const named = await h.waitFor(id, (value) => value.finished && value.title === 'Login');
    expect(named.name).toBe('login');
    expect(readFileSync(join(h.fakeState, 'oneshots.jsonl'), 'utf8')).toContain('--ephemeral');
  });
});
