import { describe, expect, it } from 'vitest';

import { StatsRecordRepository } from '../../src/feature/stats/repositories/index.ts';
import type { StatsReportView } from '../../src/presentation/ipc/contract/index.ts';
import { attemptRecord, taskRecord } from '../feature/stats/helpers.ts';

import { aip, ownDaemon, sandbox, type Sandbox } from './sandbox.ts';

/** Puts a task of 90 000 tokens into the journal of the sandbox daemon, and one of another project. */
async function fill(box: Sandbox): Promise<void> {
  const daemon = await ownDaemon(box);
  const records = new StatsRecordRepository(daemon.application.database);
  const at = Date.now() - 60_000;
  records.insertAttempts([
    attemptRecord({
      runId: 'app-1',
      repository: box.repo,
      inputTokens: 60_000,
      outputTokens: 30_000,
      costUsd: 0.42,
      durationMs: 90 * 60_000,
      finishedAt: at,
    }),
    attemptRecord({
      runId: 'lib-1',
      repository: '/work/lib',
      inputTokens: 10_000,
      outputTokens: 0,
      costUsd: 0.1,
      durationMs: 60_000,
      finishedAt: at,
    }),
  ]);
  records.upsertTask(taskRecord({ runId: 'app-1', repository: box.repo, finishedAt: at }));
  records.upsertTask(taskRecord({ runId: 'lib-1', repository: '/work/lib', finishedAt: at }));
}

describe('aip stats', () => {
  it('prints the totals, the per-task figures and a row for every project', async () => {
    const box = sandbox();
    await fill(box);
    const result = await aip(box, 'stats');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage');
    expect(result.stdout).toContain('Tokens 100k');
    expect(result.stdout).toContain('$0.52');
    expect(result.stdout).toContain('1h 30m');
    expect(result.stdout).toContain(box.repo);
    expect(result.stdout).toContain('/work/lib');
    expect(result.stdout).toMatch(/specialist\s+attempts/);
    expect(result.stdout).toMatch(/model\s+attempts/);
  });

  it('limits the report to a project', async () => {
    const box = sandbox();
    await fill(box);
    const result = await aip(box, 'stats', '--project', box.repo, '--json');
    const report = JSON.parse(result.stdout) as StatsReportView;
    expect(report.repository).toBe(box.repo);
    expect(report.totals.tokens).toBe(90_000);
    expect(report.projects).toHaveLength(1);
  });

  it('prints the report of the daemon as JSON for a period', async () => {
    const box = sandbox();
    await fill(box);
    const result = await aip(box, 'stats', '--since', '7d', '--json');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as StatsReportView;
    expect(report.totals).toMatchObject({ tasks: 2, tokens: 100_000 });
    expect(report.since).not.toBeNull();
    expect(report.series.length).toBeGreaterThanOrEqual(7);
    const all = JSON.parse((await aip(box, 'stats', '--since', 'all', '--json')).stdout);
    expect((all as StatsReportView).since).toBeNull();
  });

  it('refuses a wrong period with a non-zero code', async () => {
    const box = sandbox();
    const result = await aip(box, 'stats', '--since', 'soon');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('invalid period "soon"');
  });

  it('says so when collection is off', async () => {
    const box = sandbox();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(join(box.env.XDG_CONFIG_HOME as string, 'aip'), { recursive: true });
    writeFileSync(
      join(box.env.XDG_CONFIG_HOME as string, 'aip', 'settings.yaml'),
      'stats: { enabled: false }\n',
    );
    await fill(box);
    const result = await aip(box, 'stats');
    expect(result.stdout.split('\n')[0]).toContain('Collection is off');
    expect(result.stdout).toContain('Tokens 100k');
  });

  it('clears a project and prints how many records went', async () => {
    const box = sandbox();
    await fill(box);
    const cleared = await aip(box, 'stats', 'clear', '--project', box.repo);
    expect(cleared.code).toBe(0);
    expect(cleared.stdout.trim()).toBe('Removed 2 records');
    const after = JSON.parse(
      (await aip(box, 'stats', '--project', box.repo, '--json')).stdout,
    ) as StatsReportView;
    expect(after.totals).toMatchObject({ tasks: 0, tokens: 0 });
    const other = JSON.parse(
      (await aip(box, 'stats', '--project', '/work/lib', '--json')).stdout,
    ) as StatsReportView;
    expect(other.totals.tokens).toBe(10_000);
  });
});
