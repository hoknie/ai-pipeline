import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { databasePath } from '../../src/platform/paths/index.ts';
import type { RunCreated } from '../../src/presentation/ipc/contract/index.ts';

import { harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SLUG = '_action-before-delivery-check';

/** A pipeline with one step and the action `check` before delivery. */
async function start(action: string): Promise<Harness> {
  current = await harness(`swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
  actions:
    check: ${action}
  stages:
    before_delivery: [check]
  delivery: { auto: false }
  pipelines:
    plain:
      steps:
        - { id: code, specialist: coder }
`);
  return current;
}

/** Runs the pipeline to the end of its steps, delivers it and waits for the action. */
async function runCheck(h: Harness): Promise<string> {
  const created = (await startRun(h, {
    repository: h.repo,
    pipeline: 'plain',
    groups: [{ title: 'Вход', task: 'вход' }],
  })) as RunCreated;
  await h.waitFor(created.runId, (run) => run.finished);
  await h.call('apply', { runId: created.runId });
  await h.waitFor(created.runId, (run) => run.system[0]?.status !== 'running' && run.finished);
  return created.runId;
}

async function logOf(h: Harness, runId: string): Promise<string[]> {
  return (await h.group(runId, SLUG)).log?.lines ?? [];
}

describe('an action with one script', () => {
  it('runs the lines in order and logs the script once', async () => {
    const h = await start('{ run: "echo one\\necho two" }');
    const runId = await runCheck(h);
    expect((await h.status(runId)).system[0]?.status).toBe('done');
    const lines = await logOf(h, runId);
    expect(lines[0]).toBe('[aip] $ echo one');
    expect(lines.filter((line) => /^(one|two)$/.test(line))).toEqual(['one', 'two']);
  });

  it('fails with the exit code of the script', async () => {
    const h = await start('{ run: "exit 2\\ntouch $AIP_REPOSITORY/../marker" }');
    const runId = await runCheck(h);
    expect((await h.status(runId)).system[0]).toMatchObject({
      status: 'failed',
      reason: 'exit code 2',
    });
    expect(existsSync(join(h.repo, '..', 'marker'))).toBe(false);
  });

  it('passes quotes and variables to the script as they are written', async () => {
    const h = await start(
      `{ run: "printf '%s|%s' \\"$AIP_ACTION\\" 'it is' > $AIP_REPOSITORY/../out" }`,
    );
    const runId = await runCheck(h);
    expect((await h.status(runId)).system[0]?.status).toBe('done');
    expect(readFileSync(join(h.repo, '..', 'out'), 'utf8')).toBe('check|it is');
  });

  it('joins a list stored in an old run snapshot and stops at the first failure', async () => {
    const h = await start('{ run: "true" }');
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'plain',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    await h.waitFor(created.runId, (run) => run.finished);
    await h.restart(() => {
      const database = new DatabaseSync(databasePath(h.state));
      const row = database
        .prepare('SELECT config_json FROM runs WHERE id = ?')
        .get(created.runId) as { config_json: string };
      const config = JSON.parse(row.config_json) as {
        actions: { id: string; run: unknown }[];
      };
      const action = config.actions.find((item) => item.id === 'check')!;
      action.run = ['exit 2', `touch ${join(h.repo, '..', 'marker')}`];
      database
        .prepare('UPDATE runs SET config_json = ? WHERE id = ?')
        .run(JSON.stringify(config), created.runId);
      database.close();
    });
    await h.call('apply', { runId: created.runId });
    await h.waitFor(created.runId, (run) => run.system[0]?.status !== 'running' && run.finished);
    expect((await h.status(created.runId)).system[0]).toMatchObject({
      status: 'failed',
      reason: 'exit code 2',
    });
    expect(existsSync(join(h.repo, '..', 'marker'))).toBe(false);
  });

  it('times out over all its lines', async () => {
    // 10 s last 500 ms here: each line fits, the two together do not.
    const h = await start('{ run: "sleep 0.3\\nsleep 0.3", timeout: 10 }');
    const runId = await runCheck(h);
    expect((await h.status(runId)).system[0]).toMatchObject({
      status: 'failed',
      reason: 'timeout',
    });
  });
});
