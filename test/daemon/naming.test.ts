import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunCreated } from '../../src/protocol/index.ts';

import { MANUAL_CONFIG, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(script: Record<string, unknown>, config = MANUAL_CONFIG): Promise<Harness> {
  current = await harness(config);
  current.script(script);
  return current;
}

async function create(h: Harness, extra: Record<string, unknown> = {}): Promise<string> {
  const { runId } = (await startRun(h, {
    repository: h.repo,
    workflow: 'feature',
    task: 'Добавить флаг --json к команде aip version\nподробности',
    ...extra,
  })) as RunCreated;
  return runId;
}

describe('run names', () => {
  it('names the run in the background while its steps already run', async () => {
    const h = await start({
      naming: {
        delayMs: 800,
        answer: '{"title": "Флаг --json для version", "name": "add-version-json-flag"}',
      },
      code: [{ delayMs: 1500 }],
    });
    const runId = await create(h);
    const early = await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    expect(early.name).toBeNull();
    expect(early.title).toBe('Добавить флаг --json к команде aip version');
    const named = await h.waitFor(runId, (view) => view.name !== null);
    expect(named).toMatchObject({
      title: 'Флаг --json для version',
      name: 'add-version-json-flag',
    });
    expect(named.usage?.costUsd).toBeGreaterThanOrEqual(0.002);
    const calls = readFileSync(join(h.fakeState, 'oneshots.jsonl'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0] ?? '{}').args).toEqual(expect.arrayContaining(['--model', 'haiku']));
  });

  it('keeps the first line of the task when the answer is not usable', async () => {
    const h = await start({ naming: { answer: 'sure, here: Flag' } });
    const runId = await create(h);
    await h.waitFor(runId, (view) => view.finished);
    for (let tries = 0; tries < 30 && !existsSync(join(h.fakeState, 'oneshots.jsonl')); tries += 1)
      await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const view = await h.status(runId);
    expect(view).toMatchObject({ name: null, title: 'Добавить флаг --json к команде aip version' });
  });

  it('does not ask the model for a title given at the start, nor when naming is off', async () => {
    const h = await start({ naming: { answer: '{"title": "x", "name": "x"}' } });
    const runId = await create(h, { title: 'Вход по OAuth' });
    const view = await h.waitFor(runId, (run) => run.finished);
    expect(view).toMatchObject({ title: 'Вход по OAuth', name: 'vhod-po-oauth' });
    await h.close();
    current = null;
    const off = await start(
      { naming: { answer: '{"title": "x", "name": "x"}' } },
      `${MANUAL_CONFIG}  naming: { enabled: false }\n`,
    );
    const second = await create(off);
    await off.waitFor(second, (run) => run.finished);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(existsSync(join(h.fakeState, 'oneshots.jsonl'))).toBe(false);
    expect(existsSync(join(off.fakeState, 'oneshots.jsonl'))).toBe(false);
  });
});
