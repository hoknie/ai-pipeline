import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  RunCreated,
  StatsClearView,
  StatsReportView,
} from '../../src/presentation/ipc/contract/index.ts';

import { CODE_ONLY_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(): Promise<Harness> {
  current = await harness(CODE_ONLY_CONFIG);
  return current;
}

/** Writes the `stats` section of the shared settings.yaml and lets the daemon notice it. */
async function settings(h: Harness, text: string): Promise<void> {
  const directory = join(h.environment.XDG_CONFIG_HOME as string, 'aip');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'settings.yaml'), text);
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function finishedRun(h: Harness): Promise<string> {
  const created = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups: [{ title: 'Вход', task: 'вход' }],
  })) as RunCreated;
  await h.waitFor(created.runId, (view) => view.finished);
  return created.runId;
}

async function report(h: Harness, params = {}): Promise<StatsReportView> {
  return (await h.call('stats_report', params)) as StatsReportView;
}

/** The report once the journal holds this many tasks: the journal is written right after the run is saved. */
async function reportWithTasks(h: Harness, tasks: number): Promise<StatsReportView> {
  await until(
    `${tasks} tasks in the journal`,
    async () => (await report(h)).totals.tasks === tasks,
  );
  return report(h);
}

const coderAttempts = (view: StatsReportView): number =>
  view.bySpecialist.find((row) => row.key === 'coder')?.attempts ?? 0;

describe('usage statistics of the daemon', () => {
  it('records the attempt with the tokens of the fake agent and the finished task', async () => {
    const h = await start();
    await finishedRun(h);
    const view = await reportWithTasks(h, 1);
    expect(view.settings).toMatchObject({ enabled: true, exclude: [], showCost: true });
    expect(view.settings.backfilledAt).not.toBeNull();
    const coder = view.bySpecialist.find((row) => row.key === 'coder');
    expect(coder).toMatchObject({ attempts: 1, inputTokens: 100, outputTokens: 20 });
    expect(view.outcomes.finished).toBe(1);
    expect(view.projects.map((project) => project.repository)).toEqual([h.repo]);
    expect(view.byRuntime.map((row) => row.key)).toContain('claude');
  });

  it('records nothing new after stats.enabled is written false, with the daemon running', async () => {
    const h = await start();
    await finishedRun(h);
    await reportWithTasks(h, 1);
    await settings(h, 'stats: { enabled: false }\n');
    await finishedRun(h);
    const off = await report(h);
    expect(off.settings.enabled).toBe(false);
    // Captures run in order: once the marker run below is in the journal, the one above was decided.
    await settings(h, 'stats: { enabled: true }\n');
    await finishedRun(h);
    const view = await reportWithTasks(h, 2);
    expect(view.totals.tasks).toBe(2);
    expect(coderAttempts(view)).toBe(2);
  });

  it('does not record an excluded project and hides it from the report', async () => {
    const h = await start();
    await finishedRun(h);
    await reportWithTasks(h, 1);
    await settings(h, `stats: { exclude: [${JSON.stringify(h.repo)}] }\n`);
    await finishedRun(h);
    const hidden = await report(h);
    expect(hidden.totals).toMatchObject({ tasks: 0, attempts: 0, tokens: 0 });
    expect(hidden.projects).toEqual([]);
    await settings(h, 'stats: { enabled: true }\n');
    // The marker run is recorded after the excluded one was decided, so a late write would show.
    await finishedRun(h);
    const shown = await reportWithTasks(h, 2);
    expect(shown.totals.tasks).toBe(2);
    expect(coderAttempts(shown)).toBe(2);
  });

  it('hides the cost with show_cost false and keeps the tokens', async () => {
    const h = await start();
    await finishedRun(h);
    await reportWithTasks(h, 1);
    await settings(h, 'stats: { show_cost: false }\n');
    const view = await report(h);
    expect(view.totals.costUsd).toBeNull();
    expect(view.totals.tokens).toBeGreaterThan(0);
  });

  it('moves the history of an older database once, at the first start with collection on', async () => {
    const h = await start();
    await finishedRun(h);
    await reportWithTasks(h, 1);
    h.running.application.database.exec(
      'DELETE FROM stats_attempts; DELETE FROM stats_runs; UPDATE stats_meta SET backfilled_at = NULL;',
    );
    expect((await report(h)).totals.tasks).toBe(0);
    await h.restart();
    const moved = await report(h);
    expect(moved.totals.tasks).toBe(1);
    expect(coderAttempts(moved)).toBe(1);
    expect(moved.settings.backfilledAt).not.toBeNull();
    await h.restart();
    expect((await report(h)).totals.tasks).toBe(1);
  });

  it('waits with the move while collection is off, then moves the whole history', async () => {
    const h = await start();
    await finishedRun(h);
    await reportWithTasks(h, 1);
    h.running.application.database.exec(
      'DELETE FROM stats_attempts; DELETE FROM stats_runs; UPDATE stats_meta SET backfilled_at = NULL;',
    );
    await settings(h, 'stats: { enabled: false }\n');
    await h.restart();
    expect((await report(h)).settings.backfilledAt).toBeNull();
    await settings(h, 'stats: { enabled: true }\n');
    await finishedRun(h);
    const view = await reportWithTasks(h, 2);
    expect(coderAttempts(view)).toBe(2);
  });

  it('clears the records of a project and leaves its runs', async () => {
    const h = await start();
    const runId = await finishedRun(h);
    await reportWithTasks(h, 1);
    const cleared = (await h.call('stats_clear', { repository: h.repo })) as StatsClearView;
    expect(cleared.removed).toBeGreaterThanOrEqual(2);
    const view = await report(h, { repository: h.repo });
    expect(view.totals).toMatchObject({ tasks: 0, attempts: 0 });
    expect((await h.status(runId)).finished).toBe(true);
    expect(
      ((await h.call('stats_clear', { repository: '/work/unknown' })) as StatsClearView).removed,
    ).toBe(0);
    await h.restart();
    expect((await report(h)).totals.tasks).toBe(0);
  });
});
