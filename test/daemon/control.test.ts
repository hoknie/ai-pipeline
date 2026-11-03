import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeConfigDirectory } from '../fixtures/config.ts';
import type { RunView } from '../../src/protocol/index.ts';
import { WORKFLOW_CONFIG, statuses, until } from './harness.ts';
import { SHORT_TIMEOUT, alive, calls, run, start } from './control-harness.ts';

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
    const childrenFile = join(h.fakeState, 'children');
    await until('the child of the agent', () => existsSync(childrenFile));
    const children = readFileSync(childrenFile, 'utf8').trim().split('\n').map(Number);
    expect(children.filter(alive)).toHaveLength(1);
    await h.call('cancel', { runId });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['cancelled']);
    await until('the child stopped', () => children.filter(alive).length === 0);
    expect(children.filter(alive)).toEqual([]);
  });

  it('resumes a cancelled group and merges it', async () => {
    const h = await start();
    h.script({ code: [{ hang: true }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    // the agent process runs: the cancel stops it, not a launch still in progress
    await until('the agent started', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    await h.call('cancel', { runId });
    const cancelled = await h.waitFor(runId, (view) => view.finished);
    expect(cancelled.state).toBe('cancelled');
    await h.call('retry', { runId, group: 'g1' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(final.state).toBe('finished');
  });

  it('skips an upcoming step: the step never runs', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    const skipped = (await h.call('run_skip', { runId, step: 'review', skip: true })) as {
      steps: { id: string; skipped: boolean }[];
    };
    expect(skipped.steps.find((entry) => entry.id === 'review')?.skipped).toBe(true);
    h.open('code');
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(calls(h).map((call) => call.step)).toEqual(['code']);
  });

  it('skips a running step: it is stopped and the group is merged', async () => {
    const h = await start();
    h.script({ review: [{ hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.steps[1]?.state === 'active');
    await h.waitFor(runId, (view) => view.groups[0]?.step === 'review');
    await h.call('run_skip', { runId, step: 'review', skip: true });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    const group = await h.group(runId, 'g1');
    const review = group.attempts.filter((attempt) => attempt.stepId === 'review');
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ status: 'cancelled' });
  });

  it('keeps the skipped steps after a restart and refuses a passed step', async () => {
    const h = await start();
    h.script({ review: [{ hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.step === 'review');
    await expect(h.call('run_skip', { runId, step: 'code', skip: true })).rejects.toThrow(
      'already passed',
    );
    await h.call('run_skip', { runId, step: 'review', skip: true });
    await h.waitFor(runId, (view) => view.finished);
    await h.restart();
    const view = await h.status(runId);
    expect(view.steps.find((entry) => entry.id === 'review')?.skipped).toBe(true);
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
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const runId = await run(h, 4);
    let peak = 0;
    const running = (view: RunView) =>
      view.groups.filter((group) => group.status === 'running').length;
    // two coders hold their places; the other two groups must wait however long they work
    await h.waitFor(runId, (view) => running(view) === 2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(running(await h.status(runId))).toBe(2);
    h.open('code');
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

  it('retries with the current specialists only when asked to', async () => {
    const h = await start(
      WORKFLOW_CONFIG.replace(
        'reviewer: { name: Ревьюер, permissions: read }',
        'reviewer: { name: Ревьюер, permissions: read, model: opsu }',
      ),
    );
    h.script({ review: [{ exitCode: 1, noReport: true }, { exitCode: 1, noReport: true }, {}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    writeConfigDirectory(
      h.repo,
      WORKFLOW_CONFIG.replace(
        'reviewer: { name: Ревьюер, permissions: read }',
        'reviewer: { name: Ревьюер, permissions: read, model: opus }',
      ),
    );
    await h.call('retry', { runId, group: 'g1' });
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    await h.call('retry', { runId, group: 'g1', refreshConfig: true });
    await h.waitFor(runId, (view) => view.finished);
    const models = calls(h)
      .filter((call) => call.step === 'review')
      .map((call) => call.args[call.args.indexOf('--model') + 1]);
    expect(models).toEqual(['opsu', 'opsu', 'opus']);
    expect(calls(h).filter((call) => call.step === 'code')).toHaveLength(1);
    const detail = await h.group(runId, 'g1');
    expect(detail.status).toBe('merged');
    expect(detail.warnings).toContain('config refreshed: reviewer model opsu → opus');
  });

  it('refuses a retry with the current configuration when it is broken', async () => {
    const h = await start();
    h.script({ code: [{ exitCode: 1, noReport: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'failed');
    writeConfigDirectory(h.repo, WORKFLOW_CONFIG.replace('max: 3', 'max: 100'));
    await expect(h.call('retry', { runId, group: 'g1', refreshConfig: true })).rejects.toThrow(
      /^configuration not loaded: swarm\.max/,
    );
    const detail = await h.group(runId, 'g1');
    expect(detail.status).toBe('failed');
    expect(detail.warnings).toEqual([]);
    expect(
      ((await h.call('queue', { repository: h.repo })) as { runs: string[] }).runs,
    ).not.toContain(runId);
  });
});
