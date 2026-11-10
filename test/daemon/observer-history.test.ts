import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ObserverHistoryView, RunCreated } from '../../src/presentation/ipc/contract/index.ts';
import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import { CODE_ONLY_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;
let panel: WebServer | null = null;

afterEach(async () => {
  await panel?.close();
  panel = null;
  await current?.close();
  current = null;
});

const failed = { exitCode: 1, noReport: true };
const group = [{ title: 'Вход', task: 'вход' }];

function lines(h: Harness, file: string): Record<string, unknown>[] {
  const path = join(h.fakeState, file);
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

async function start(): Promise<Harness> {
  current = await harness(CODE_ONLY_CONFIG);
  return current;
}

async function history(h: Harness): Promise<ObserverHistoryView> {
  return (await h.call('observers_history', { limit: 20 })) as ObserverHistoryView;
}

describe('история попыток наблюдателя через демон', () => {
  it('сохраняет обе попытки одной задачи после рестарта, включая модель и расход, а чтение не запускает агента', async () => {
    const h = await start();
    h.script({
      code: [failed, {}],
      repair: [
        { exitCode: 1, noReport: true, usage: [{ input: 120, output: 12 }] },
        {
          verdict: 'done',
          usage: [{ input: 30, output: 3 }],
          toolCalls: [{ name: 'swarm_repair_retry', arguments: { group: 'vhod' } }],
        },
      ],
    });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: {
        enabled: true,
        projects: [{ repository: h.repo, maxWorkers: null }],
        specialist: { runtime: 'claude', model: 'history-model-v1' },
      },
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished && run.state === 'finished');

    const beforeRestart = await history(h);
    expect(beforeRestart.items).toHaveLength(2);
    expect(beforeRestart.items.map((item) => item.attemptSeq)).toEqual([2, 1]);
    expect(beforeRestart.items.map((item) => item.result)).toEqual(['done', 'failed']);
    expect(beforeRestart.items.map((item) => item.model)).toEqual([
      'history-model-v1',
      'history-model-v1',
    ]);
    expect(beforeRestart.items[1]).toMatchObject({
      runId,
      usage: { inputTokens: 120, outputTokens: 12 },
    });

    panel = await startWebServer({
      socket: h.socket,
      port: 0,
      token: 'observer-history-integration-token',
      repository: '/not-the-filtered-repository',
      ensureDaemon: async () => ({ mismatch: null }) as never,
    });
    const response = await fetch(
      `http://127.0.0.1:${panel.port}/api/observers/history?repository=${encodeURIComponent(h.repo)}`,
      {
        headers: { 'x-aip-token': panel.token ?? '' },
      },
    );
    expect(response.status).toBe(200);
    const httpHistory = (await response.json()) as ObserverHistoryView;
    expect(httpHistory.items.map((item) => item.result)).toEqual(['done', 'failed']);
    expect(httpHistory.items.every((item) => item.repository === h.repo)).toBe(true);

    await h.call('observers_set', {
      settings: {
        enabled: false,
        projects: [{ repository: h.repo, maxWorkers: null }],
        specialist: { runtime: 'claude', model: 'history-model-v2' },
      },
    });
    await h.restart();
    const afterRestart = await history(h);
    expect(afterRestart.items).toEqual(beforeRestart.items);
    expect(afterRestart.items.map((item) => item.model)).not.toContain('history-model-v2');
    const attempts = lines(h, 'calls.jsonl').filter((call) => call.step === 'repair');
    expect(attempts).toHaveLength(2);
    await history(h);
    await history(h);
    expect(lines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(2);
  });

  it('returns a running attempt with its last persisted usage without starting another worker', async () => {
    const h = await start();
    h.script({
      code: [failed],
      repair: [{ usage: [{ input: 321, output: 23 }], waitFor: h.gate('repair') }],
    });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await until('running observer usage', async () => {
      const page = await history(h);
      return page.items.some(
        (item) => item.result === 'running' && item.usage?.inputTokens === 321,
      );
    });
    const page = await history(h);
    expect(page.items[0]).toMatchObject({
      runId,
      result: 'running',
      finishedAt: null,
      usage: { inputTokens: 321, outputTokens: 23 },
    });
    expect(lines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(1);
    h.open('repair');
  });

  it('retains rejected and needs_human outcomes with usage and exposes them through real HTTP', async () => {
    const h = await start();
    h.script({
      code: [failed, failed],
      repair: [
        { verdict: 'rejected', feedback: 'Нужно исправить', usage: [{ input: 41, output: 9 }] },
        {
          verdict: 'needs_human',
          questions: [{ text: 'Продолжать?' }],
          usage: [{ input: 51, output: 11 }],
        },
      ],
    });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    const rejected = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await h.waitFor(rejected.runId, (run) => run.finished);
    const needsHuman = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await h.waitFor(needsHuman.runId, (run) => run.finished || run.state === 'needs_human');

    panel = await startWebServer({
      socket: h.socket,
      port: 0,
      token: 'observer-history-outcomes-token',
      repository: '/unrelated',
      ensureDaemon: async () => ({ mismatch: null }) as never,
    });
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/observers/history`, {
      headers: { 'x-aip-token': panel.token ?? '' },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as ObserverHistoryView;
    expect(page.items.map((item) => item.result)).toEqual(['needs_human', 'rejected']);
    expect(page.items.map((item) => item.usage?.inputTokens)).toEqual([51, 41]);
    expect(page.items.every((item) => item.startedAt > 0 && item.finishedAt !== null)).toBe(true);
    const callsBeforeReads = lines(h, 'calls.jsonl').filter(
      (call) => call.step === 'repair',
    ).length;
    await fetch(`http://127.0.0.1:${panel.port}/api/observers/history`, {
      headers: { 'x-aip-token': panel.token ?? '' },
    });
    expect(lines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(
      callsBeforeReads,
    );
  });

  it('records an interrupted running attempt after restart and returns it over HTTP', async () => {
    const h = await start();
    h.script({ code: [failed], repair: [{ usage: [{ input: 71, output: 7 }], hang: true }] });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await until('running repair attempt', async () => {
      const page = await history(h);
      return page.items.some((item) => item.result === 'running' && item.usage?.inputTokens === 71);
    });
    await h.restart();
    panel = await startWebServer({
      socket: h.socket,
      port: 0,
      token: 'observer-history-interrupted-token',
      repository: '/unrelated',
      ensureDaemon: async () => ({ mismatch: null }) as never,
    });
    const response = await fetch(
      `http://127.0.0.1:${panel.port}/api/observers/history?repository=${encodeURIComponent(h.repo)}`,
      {
        headers: { 'x-aip-token': panel.token ?? '' },
      },
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as ObserverHistoryView;
    expect(page.items.find((item) => item.failureKind === 'interrupted')).toMatchObject({
      runId,
      result: 'failed',
      failureKind: 'interrupted',
      usage: { inputTokens: 71, outputTokens: 7 },
    });
    expect(
      page.items.find((item) => item.failureKind === 'interrupted')!.finishedAt,
    ).not.toBeNull();
  });

  it('keeps a cancelled observer attempt in the read-only HTTP history', async () => {
    const h = await start();
    h.script({ code: [failed], repair: [{ usage: [{ input: 81, output: 8 }], hang: true }] });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await until('running repair usage to cancel', async () =>
      (await history(h)).items.some(
        (item) => item.result === 'running' && item.usage?.inputTokens === 81,
      ),
    );
    await h.call('cancel', { runId, group: '_repair' });
    await until('cancelled history item', async () =>
      (await history(h)).items.some((item) => item.result === 'cancelled'),
    );
    panel = await startWebServer({
      socket: h.socket,
      port: 0,
      token: 'observer-history-cancelled-token',
      repository: '/unrelated',
      ensureDaemon: async () => ({ mismatch: null }) as never,
    });
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/observers/history`, {
      headers: { 'x-aip-token': panel.token ?? '' },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as ObserverHistoryView;
    expect(page.items.find((item) => item.result === 'cancelled')).toMatchObject({
      result: 'cancelled',
      usage: { inputTokens: 81, outputTokens: 8 },
    });
    expect(lines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(1);
  });

  it('records a repair spawn failure through the real history endpoint', async () => {
    const h = await start();
    h.environment.AIP_OPENCODE_BIN = '/missing/observer-opencode';
    h.script({ code: [failed] });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: {
        enabled: true,
        projects: [{ repository: h.repo, maxWorkers: null }],
        specialist: { runtime: 'opencode', model: 'test/spawn-test-model' },
      },
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: group,
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.finished);
    panel = await startWebServer({
      socket: h.socket,
      port: 0,
      token: 'observer-history-spawn-token',
      repository: '/unrelated',
      ensureDaemon: async () => ({ mismatch: null }) as never,
    });
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/observers/history`, {
      headers: { 'x-aip-token': panel.token ?? '' },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as ObserverHistoryView;
    expect(page.items[0]).toMatchObject({
      runId,
      runtime: 'opencode',
      model: 'test/spawn-test-model',
      result: 'failed',
      failureKind: 'runtime_not_found',
    });
    expect(page.items[0]!.finishedAt).not.toBeNull();
  });

  it('includes a completed attempt older than the recent-run window', async () => {
    const h = await harness(CODE_ONLY_CONFIG.replace('max: 3', 'max: 20'));
    current = h;
    h.script({
      code: [failed, ...Array.from({ length: 10 }, () => ({}))],
      repair: [{ verdict: 'done' }],
    });
    await h.call('repository_add', { path: h.repo });
    await h.call('observers_set', {
      settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }] },
    });
    const runs: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const { runId } = (await startRun(h, {
        repository: h.repo,
        pipeline: 'feature',
        groups: group,
      })) as RunCreated;
      runs.push(runId);
      await h.waitFor(runId, (run) => run.finished);
    }
    panel = await startWebServer({
      socket: h.socket,
      port: 0,
      token: 'observer-history-old-token',
      repository: '/unrelated',
      ensureDaemon: async () => ({ mismatch: null }) as never,
    });
    const response = await fetch(`http://127.0.0.1:${panel.port}/api/observers/history?limit=50`, {
      headers: { 'x-aip-token': panel.token ?? '' },
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as ObserverHistoryView;
    expect(page.items).toHaveLength(1);
    expect(page.items.some((item) => item.runId === runs[0] && item.result === 'done')).toBe(true);
    expect(lines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(1);
  }, 10_000);
});
