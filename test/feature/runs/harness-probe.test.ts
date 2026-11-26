import { describe, expect, it } from 'vitest';

import { harnessProbe } from '../../../src/feature/runs/services/probes/harness-probe.ts';
import type { Attempt } from '../../../src/feature/runs/types/index.ts';
import { group, run } from './helpers.ts';

describe('probe evidence', () => {
  it('uses only this run’s complete journal and the configured review step', () => {
    const state = run(1, { id: 'r1' });
    const work = group(state);
    work.status = 'merged';
    work.attempts.push({
      seq: 1,
      stepId: 'review',
      round: 1,
      status: 'finished',
      report: { verdict: 'done' },
      denials: [{}],
      outsideChanges: ['x'],
      usage: { inputTokens: 4, outputTokens: 3 },
    } as unknown as Attempt);
    work.attempts.push({ seq: 2, status: 'running' } as Attempt);
    const row = {
      runId: 'r1',
      group: work.slug,
      seq: 1,
      durationMs: 30,
      inputTokens: 4,
      outputTokens: 3,
    };
    const summary = harnessProbe(state, { applied: false, conflicts: ['x', 'y'] }, null, {
      attempts: [
        row,
        { ...row, runId: 'other', durationMs: 999 },
        { ...row, seq: 2, durationMs: 999 },
      ],
      wallMs: 40,
    });
    expect(summary).toMatchObject({
      runId: 'r1',
      actualDelivery: 'not_attempted',
      allGroupsMerged: true,
      check: { applied: false, conflicts: 2 },
      denials: 1,
      outsideChanges: 1,
      cost: null,
      wallMs: 40,
      attemptDurationMs: 30,
      inputTokens: 4,
      outputTokens: 3,
      reviewerGroups: ['group-1'],
      reviewerAttempts: [{ group: 'group-1', round: 1, verdict: 'done' }],
    });
    const missing = harnessProbe(state, null, 'failed', { attempts: [], wallMs: null });
    expect(missing.check).toEqual({ applied: null, conflicts: null, error: 'failed' });
    expect(missing.attemptDurationMs).toBeNull();
    expect(missing.inputTokens).toBeNull();
  });

  it('distinguishes measured zero usage from missing usage across attempts', () => {
    const state = run(1, { id: 'r1' });
    const work = group(state);
    work.status = 'merged';
    work.attempts.push(
      { seq: 1, status: 'finished', usage: { inputTokens: 0, outputTokens: 0 } } as Attempt,
      { seq: 2, status: 'finished' } as Attempt,
    );
    const stats = {
      attempts: [1, 2].map((seq) => ({
        runId: 'r1',
        group: work.slug,
        seq,
        durationMs: 10,
        inputTokens: 0,
        outputTokens: 0,
      })),
      wallMs: 20,
    };
    expect(harnessProbe(state, null, null, stats)).toMatchObject({
      attemptDurationMs: 20,
      inputTokens: null,
      outputTokens: null,
    });
    work.attempts[1]!.usage = { inputTokens: 0, outputTokens: 0 } as Attempt['usage'];
    expect(harnessProbe(state, null, null, stats)).toMatchObject({
      attemptDurationMs: 20,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('records a failed group even when the merged group passes the check', () => {
    const state = run(2);
    group(state, 'group-1').status = 'merged';
    group(state, 'group-2').status = 'failed';
    const summary = harnessProbe(state, { applied: true, conflicts: [] }, null, {
      attempts: [],
      wallMs: null,
    });
    expect(summary.allGroupsMerged).toBe(false);
    expect(summary.check.applied).toBe(true);
  });

  it('does not infer check results for an unfinished run', () => {
    const summary = harnessProbe(run(1), { applied: true, conflicts: [] }, null, {
      attempts: [],
      wallMs: null,
    });
    expect(summary.check).toMatchObject({ applied: null, conflicts: null });
  });
});
