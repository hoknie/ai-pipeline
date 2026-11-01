import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startDaemon } from '../../src/daemon/index.ts';
import type { RunCreated, Transcript } from '../../src/protocol/index.ts';

import { WORKFLOW_CONFIG, harness, startRun, statuses, type Harness } from './harness.ts';
import { writeConfigDirectory } from '../fixtures/config.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(config?: string, environment?: NodeJS.ProcessEnv): Promise<Harness> {
  current = await harness(config, environment);
  return current;
}

async function run(h: Harness, count = 1): Promise<string> {
  const groups = Array.from({ length: count }, (_, index) => ({
    title: `g${index + 1}`,
    task: `task ${index + 1}`,
  }));
  return ((await startRun(h, { repository: h.repo, workflow: 'feature', groups })) as RunCreated)
    .runId;
}

function calls(h: Harness): { step: string; group: string; args: string[] }[] {
  return readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const SHORT_TIMEOUT = WORKFLOW_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, timeout: 2s }',
);

describe('failures and control', () => {
  it('fails a step that exceeds its timeout and stops the process', async () => {
    const h = await start(SHORT_TIMEOUT);
    h.script({ code: [{ hang: true }] });
    const runId = await run(h);
    const final = await h.waitFor(runId, (view) => view.finished, 15_000);
    expect(final.groups[0]).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('stops the specialist and its children on cancel', async () => {
    const h = await start();
    h.script({ code: [{ child: true, hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const children = readFileSync(join(h.fakeState, 'children'), 'utf8')
      .trim()
      .split('\n')
      .map(Number);
    expect(children.filter(alive)).toHaveLength(1);
    await h.call('cancel', { runId });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['cancelled']);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(children.filter(alive)).toEqual([]);
  });

  it('resumes a cancelled group and merges it', async () => {
    const h = await start();
    h.script({ code: [{ hang: true }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await h.call('cancel', { runId });
    const cancelled = await h.waitFor(runId, (view) => view.finished);
    expect(cancelled.state).toBe('cancelled');
    await h.call('retry', { runId, group: 'g1' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(final.state).toBe('finished');
  });

  it('refuses to retry a merged group', async () => {
    const h = await start();
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    // A merged group is final; cancelling one in the middle of a merge is covered in the core
    // tests, here the retry of an already merged group is refused.
    await expect(h.call('retry', { runId, group: 'g1' })).rejects.toThrow(
      'needs failed, cancelled or conflict',
    );
  });

  it('never runs more than max specialists at once', async () => {
    const h = await start(WORKFLOW_CONFIG.replace('max: 3', 'max: 2'));
    h.script({ code: [{ delayMs: 600 }], review: [{ delayMs: 300 }] });
    const runId = await run(h, 4);
    let peak = 0;
    const final = await h.waitFor(runId, (view) => {
      peak = Math.max(peak, view.groups.filter((group) => group.status === 'running').length);
      return view.finished;
    });
    expect(statuses(final)).toEqual(['merged', 'merged', 'merged', 'merged']);
    expect(peak).toBe(2);
  });

  it('retries a step that ended without a report', async () => {
    const h = await start();
    h.script({ code: [{ noReport: true }, {}] });
    const runId = await run(h);
    const failed = await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    expect((await h.status(runId)).groups[0]?.reason).toBe('no report');
    expect(failed.state).toBe('failed');
    await h.call('retry', { runId, group: 'g1' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.state).toBe('finished');
    expect(statuses(final)).toEqual(['merged']);
    expect(calls(h).filter((call) => call.step === 'code')).toHaveLength(2);
  });

  it('returns rejected work to the coder and resumes the session after an answer', async () => {
    const h = await start();
    h.script({
      code: [{ verdict: 'needs_human', feedback: 'OAuth или пароль?' }, {}],
      review: [{ verdict: 'rejected', feedback: 'нет тестов' }, {}],
    });
    const runId = await run(h);
    const waiting = await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    expect(waiting.groups[0]?.question).toBe('OAuth или пароль?');
    expect(waiting).toMatchObject({ state: 'needs_human', waiting: 1, finished: false });
    await h.call('answer', { runId, group: 'g1', answer: 'OAuth' });
    const answered = await h.status(runId);
    expect(answered.waiting).toBe(0);
    expect(answered.state).not.toBe('needs_human');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const codeCalls = calls(h).filter((call) => call.step === 'code');
    expect(codeCalls).toHaveLength(3);
    expect(codeCalls[1]?.args).toContain('--resume');
    expect(codeCalls[2]?.args.join(' ')).toContain('нет тестов');
    const detail = await h.group(runId, 'g1');
    expect(detail.attempts.map((attempt) => `${attempt.stepId}:${attempt.verdict}`)).toEqual([
      'code:needs_human',
      'code:done',
      'review:rejected',
      'code:done',
      'review:done',
    ]);
  });

  it('keeps structured questions of the specialist until the human answers', async () => {
    const h = await start();
    const questions = [
      { text: 'OAuth или пароль?', options: ['OAuth', 'пароль'], recommendation: 'OAuth' },
      { text: 'Где хранить сессии?' },
    ];
    h.script({ code: [{ verdict: 'needs_human', questions }, {}] });
    const runId = await run(h);
    const waiting = await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    expect(waiting.groups[0]?.questions).toEqual(questions);
    expect(waiting.groups[0]?.question).toContain('1. OAuth или пароль?');
    expect(waiting.groups[0]?.question).toContain('Recommended: OAuth');
    expect((await h.group(runId, 'g1')).questions).toEqual(questions);
    await h.call('answer', { runId, group: 'g1', answer: 'Q1: OAuth\nA1: OAuth' });
    expect((await h.group(runId, 'g1')).questions).toBeNull();
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const codeCalls = calls(h).filter((call) => call.step === 'code');
    expect(codeCalls[1]?.args.join(' ')).toContain('A1: OAuth');
  });

  it('takes the permissions of the current configuration when the human answers', async () => {
    const h = await start();
    h.script({
      code: [
        {
          verdict: 'needs_human',
          feedback: 'запустите claude plugin test',
          denied: ['claude plugin test integrations/claude-code'],
        },
        {},
      ],
    });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'needs_human');
    const asked = await h.group(runId, 'g1');
    expect(asked.attempts[0]?.denials).toEqual([
      {
        tool: 'Bash',
        command: 'claude plugin test integrations/claude-code',
        suggestions: [
          { part: 'claude plugin test integrations/claude-code', pattern: 'claude plugin *' },
        ],
      },
    ]);
    expect(asked.permissionHints).toEqual(['claude plugin *']);
    writeConfigDirectory(
      h.repo,
      WORKFLOW_CONFIG.replace(
        'coder: { name: Кодировщик }',
        "coder: { name: Кодировщик, allow_commands: ['claude plugin *'] }",
      ),
    );
    await h.call('answer', { runId, group: 'g1', answer: 'добавил' });
    await h.waitFor(runId, (view) => view.finished);
    const codeCalls = calls(h).filter((call) => call.step === 'code');
    expect(codeCalls[0]?.args).not.toContain('Bash(claude plugin *)');
    expect(codeCalls[1]?.args).toContain('Bash(claude plugin *)');
    expect((await h.group(runId, 'g1')).permissionHints).toEqual([]);
  });

  it('retries with the old permissions and a warning when the configuration is broken', async () => {
    const h = await start();
    h.script({ code: [{ exitCode: 1, noReport: true }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    writeConfigDirectory(h.repo, WORKFLOW_CONFIG.replace('max: 3', 'max: 100'));
    await h.call('retry', { runId, group: 'g1' });
    await h.waitFor(runId, (view) => view.finished);
    const detail = await h.group(runId, 'g1');
    expect(detail.status).toBe('merged');
    expect(detail.warnings).toEqual([
      expect.stringMatching(/^permissions not refreshed: swarm\.max/),
    ]);
  });

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
      `${WORKFLOW_CONFIG}  outside_changes: stop\n`
        .replace('  workflows:', '  outside_changes: stop\n  workflows:')
        .replace(/\n  outside_changes: stop\n$/, '\n'),
    );
    stop.script({ code: [{ outside: { [join(stop.repo, 'README.md')]: 'stray\n' } }] });
    const stopRun = await run(stop);
    const waiting = await stop.waitFor(stopRun, (view) => view.groups[0]?.status === 'needs_human');
    expect(waiting.groups[0]?.question).toContain('README.md');
    expect((await stop.group(stopRun, 'g1')).attempts[0]?.outsideChanges).toEqual(['README.md']);
  });

  it('fails a step whose runtime is not installed', async () => {
    const h = await start(
      WORKFLOW_CONFIG.replace(
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
      WORKFLOW_CONFIG.replace(
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
      WORKFLOW_CONFIG.replace(
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
      workflow: 'feature',
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

  it('runs the groups of a split through the steps of another workflow', async () => {
    const h = await start(`swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
    reviewer: { name: Ревьюер, permissions: read }
  workflows:
    explore:
      steps:
        - { id: research, specialist: reviewer }
        - { id: write, specialist: coder }
    epic:
      split: { specialist: coder, workflow: explore }
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
      workflow: 'epic',
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

  it('marks running steps interrupted after a restart and keeps the queue', async () => {
    const h = await start(WORKFLOW_CONFIG.replace('max: 3', 'max: 1'));
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
    const h = await harness();
    current = h;
    h.script({ code: [{ delayMs: 1500 }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    let running = (await h.call('transcript', { runId, group: 'vhod' })) as Transcript;
    for (let tries = 0; tries < 50 && running.seq === null; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      running = (await h.call('transcript', { runId, group: 'vhod' })) as Transcript;
    }
    expect(running).toMatchObject({ seq: 1, running: true, entries: [] });
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

describe('workflows view', () => {
  it('names the file of a syntax error in aip/settings.yaml', async () => {
    const h = await start();
    const file = join(h.repo, 'aip', 'settings.yaml');
    writeFileSync(file, 'max: [\n');
    const view = (await h.call('workflows', { repository: h.repo })) as {
      workflows: unknown[];
      errors: { file?: string; path: string; message: string }[];
    };
    expect(view.workflows).toEqual([]);
    expect(view.errors).toEqual([{ path: file, message: expect.stringContaining(file) }]);
  });

  it('gives a validation error the file it comes from', async () => {
    const h = await start();
    const file = join(h.repo, 'aip', 'settings.yaml');
    writeFileSync(file, 'max: 0\n');
    const view = (await h.call('workflows', { repository: h.repo })) as {
      errors: { file?: string; path: string }[];
    };
    expect(view.errors).toContainEqual(expect.objectContaining({ file, path: 'swarm.max' }));
  });
});
