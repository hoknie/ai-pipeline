import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunCreated } from '../../src/presentation/ipc/contract/index.ts';
import { settle, startRun } from './harness.ts';
import { add, allRuns, queueOf, start, waitQueue } from './queue-harness.ts';
import { CONFIG, finding } from '../feature/runs/review/helpers.ts';

const implementation = (repair = false) => ({
  files: ['form.ts'],
  resolutions: repair
    ? [{ id: 'R1', change: 'Preserve the raw value', tests: 'Rename payload matrix passed' }]
    : [],
  checks: [{ command: 'npm run check', result: 'passed', evidence: 'Final gate passed' }],
});
const rejected = { verdict: 'rejected', review: { findings: [finding()], resolved: [] } };

describe('managed review integration', () => {
  it('passes structured reports through real worker MCP, recovers once, escalates and accepts verified closure', async () => {
    const h = await start(CONFIG);
    h.script({
      plan: [
        {},
        {
          realWorker: true,
          strategy: {
            summary: 'Keep a raw source model',
            slices: [{ title: 'Preservation', acceptance: 'Types and presence survive rename' }],
          },
        },
      ],
      code: Array.from({ length: 4 }, (_, i) => ({
        realWorker: i === 0,
        implementation: implementation(i > 0),
        write: { 'form.ts': `export const iteration = ${i};\n` },
      })),
      review: [
        { realWorker: true, ...rejected },
        rejected,
        rejected,
        {
          realWorker: true,
          review: {
            findings: [],
            resolved: [{ id: 'R1', evidence: 'Payload matrix and raw source repair verified' }],
          },
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'Preserve form data',
    })) as RunCreated;
    const result = await h.waitFor(created.runId, (view) => view.finished, 30_000);
    expect(result.state).toBe('finished');
    const view = await h.group(created.runId, result.groups[0]!.slug);
    expect(view.attempts.filter((item) => item.stepId === 'plan')).toHaveLength(2);
    expect(view.attempts.filter((item) => item.specialist === 'strong')).toHaveLength(1);
    expect(view.attempts.find((item) => item.review)?.review?.findings[0]?.id).toBe('R1');
    expect(view.attempts.find((item) => item.strategy)?.strategy?.slices[0]?.acceptance).toContain(
      'Types',
    );
    const state = h.running.application.services.runs.states.get(created.runId);
    const last = state.groups[0]!.attempts.filter((item) => item.stepId === 'review').at(-1)!;
    expect(last.input.previous.filter((item) => item.stepId === 'code')).toHaveLength(1);
    await h.restart();
    expect((await h.group(created.runId, view.slug)).attempts.at(-2)?.review?.resolved[0]?.id).toBe(
      'R1',
    );
  }, 35_000);

  it('keeps an exhausted queued cycle reserved for a person with autopilot and observers enabled', async () => {
    const h = await start(CONFIG.replace('max_rounds: 8', 'max_rounds: 1'));
    h.script({
      code: [
        { implementation: implementation() },
        {
          implementation: implementation(true),
          write: { 'form.ts': 'export const fixed = true;\n' },
        },
      ],
      review: [rejected, rejected],
    });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    await h.call('queue_settings', { repository: h.repo, autoAnswer: true });
    await add(h, 'Review budget');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (view) => view.runs[0]?.problem?.reason === 'needs_human');
    const runId = (await allRuns(h))[0]!.id;
    await settle(h);
    let view = await h.status(runId);
    expect(view.groups[0]).toMatchObject({ status: 'needs_human', humanOnly: 'review_cycle' });
    expect(view.repair?.repairs).toBe(0);
    expect(h.running.application.services.runs.states.get(runId).groups[0]?.decisions).toEqual([]);
    await h.call('run_observer', { runId, enabled: true });
    await h.restart();
    await settle(h);
    view = await h.status(runId);
    expect(view.groups[0]?.humanOnly).toBe('review_cycle');
    expect((await queueOf(h)).runs[0]?.problem?.reason).toBe('needs_human');
    await expect(h.call('retry', { runId, group: view.groups[0]!.slug })).rejects.toThrow(/retry/);
  });

  it('refuses an observer answering, retrying or cancelling a protected group while repairing another incident', async () => {
    const h = await start(CONFIG.replace('max_rounds: 8', 'max_rounds: 1'));
    h.script({
      'code@Budget': [
        { implementation: implementation() },
        {
          implementation: implementation(true),
          write: { 'form.ts': 'export const fixed = true;\n' },
        },
      ],
      'code@Other': [{ noReport: true, exitCode: 1 }],
      review: [rejected, rejected],
      repair: [
        {
          realWorker: true,
          toolCalls: [
            {
              name: 'swarm_repair_answer',
              arguments: { group: 'budget', answer: 'continue anyway' },
            },
            { name: 'swarm_repair_retry', arguments: { group: 'budget' } },
            {
              name: 'swarm_repair_cancel',
              arguments: { group: 'budget', reason: 'skip the budget' },
            },
            { name: 'swarm_repair_cancel', arguments: { reason: 'cancel everything' } },
          ],
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [
        { title: 'Budget', task: 'budget' },
        { title: 'Other', task: 'other' },
      ],
    })) as RunCreated;
    await h.waitFor(
      created.runId,
      (view) =>
        view.groups.some((item) => item.slug === 'budget' && item.status === 'needs_human') &&
        view.groups.some((item) => item.slug === 'other' && item.status === 'failed'),
    );
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: {
        enabled: true,
        maxRepairs: 1,
        projects: [{ repository: h.repo, maxWorkers: null }],
      },
    });
    const done = await h.waitFor(
      created.runId,
      (view) => view.repair?.repairs === 1 && view.repair.incident === null,
    );
    expect(done.groups.find((item) => item.slug === 'budget')).toMatchObject({
      status: 'needs_human',
      humanOnly: 'review_cycle',
    });
    expect(done.repair?.cancelReason).toBeNull();
    const calls = readFileSync(join(h.fakeState, 'tools.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.result.isError)).toBe(true);
    expect((await h.group(created.runId, 'budget')).decisions).toEqual([]);
  });
});
