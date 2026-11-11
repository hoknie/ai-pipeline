import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

describe('actions with several scripts', () => {
  it('run the scripts in order and log each one', async () => {
    const h = await start('{ run: ["echo one", "echo two"] }');
    const runId = await runCheck(h);
    const view = await h.status(runId);
    expect(view.system[0]?.status).toBe('done');
    const lines = (await logOf(h, runId)).filter((line) => /one|two/.test(line));
    expect(lines).toEqual(['[aip] $ echo one', 'one', '[aip] $ echo two', 'two']);
  });

  it('stop at the first failed script with its code', async () => {
    const h = await start('{ run: ["exit 2", "touch $AIP_REPOSITORY/../marker"] }');
    const runId = await runCheck(h);
    const view = await h.status(runId);
    expect(view.system[0]).toMatchObject({ status: 'failed', reason: 'exit code 2' });
    expect(existsSync(join(h.repo, '..', 'marker'))).toBe(false);
  });

  it('go on after a script that exits with 0', async () => {
    const h = await start('{ run: ["exit 0", "echo after"] }');
    const runId = await runCheck(h);
    const view = await h.status(runId);
    expect(view.system[0]?.status).toBe('done');
    expect((await logOf(h, runId)).join('\n')).toContain('after');
  });

  it('pass quotes and variables to a script as they are written', async () => {
    const h = await start(
      `{ run: ["echo first", "printf '%s|%s' \\"$AIP_ACTION\\" 'it is' > $AIP_REPOSITORY/../out"] }`,
    );
    const runId = await runCheck(h);
    expect((await h.status(runId)).system[0]?.status).toBe('done');
    expect(readFileSync(join(h.repo, '..', 'out'), 'utf8')).toBe('check|it is');
  });

  it('share one timeout between the scripts', async () => {
    // 10 s last 500 ms here: each script fits, the two together do not.
    const h = await start('{ run: ["sleep 0.3", "sleep 0.3"], timeout: 10 }');
    const runId = await runCheck(h);
    const view = await h.status(runId);
    expect(view.system[0]).toMatchObject({ status: 'failed', reason: 'timeout' });
  });
});
