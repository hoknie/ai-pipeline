import type { AipGroup, AipRun } from '../types';

export function group(slug: string, overrides: Partial<AipGroup> = {}): AipGroup {
  return {
    slug,
    title: slug,
    status: 'running',
    step: 'code',
    round: 1,
    durationMs: 65_000,
    question: null,
    reason: null,
    warnings: 0,
    delivery: 'pending',
    ...overrides,
  };
}

export function run(id: string, groups: AipGroup[], overrides: Partial<AipRun> = {}): AipRun {
  return {
    id,
    repository: '/repo',
    pipeline: 'feature',
    branch: `aip/${id}`,
    createdAt: 0,
    finishedAt: null,
    finished: false,
    dirtyWarning: false,
    counts: `${groups.length} groups`,
    total: groups.length,
    usage: { inputTokens: 1200, outputTokens: 300, costUsd: 0.0123 },
    split: null,
    delivery: { applied: 0, merged: 0, failed: 0, inProgress: false },
    groups,
    ...overrides,
  };
}

export function snapshotLine(runs: AipRun[], seq = 1): string {
  return `${JSON.stringify({ event: 'snapshot', seq, runs })}\n`;
}

export function runLine(changed: AipRun, seq = 2): string {
  return `${JSON.stringify({ event: 'run', seq, run: changed })}\n`;
}

/** A run as an older daemon sends it: none of the optional display fields. */
export function legacyRun(id: string, groups: AipGroup[] = [group('login')]): AipRun {
  return run(id, groups);
}
