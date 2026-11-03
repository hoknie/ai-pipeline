import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type RunCreated,
  type RunView,
  type StreamEvent,
} from '../../src/protocol/index.ts';

import { harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;
let abort: AbortController | null = null;

afterEach(async () => {
  abort?.abort();
  abort = null;
  await current?.close();
  current = null;
});

async function start(): Promise<Harness> {
  current = await harness();
  return current;
}

async function run(h: Harness): Promise<string> {
  const created = (await startRun(h, {
    repository: h.repo,
    workflow: 'feature',
    groups: [{ title: 'Логин', task: 'x' }],
  })) as RunCreated;
  return created.runId;
}

/** Run views of the `run` events of the stream, collected as they come. */
function listen(h: Harness): RunView[] {
  const views: RunView[] = [];
  abort = new AbortController();
  void subscribe(
    h.socket,
    (line) => {
      const event: StreamEvent = streamEventSchema.parse(JSON.parse(line));
      if (event.event === 'run') views.push(event.run as unknown as RunView);
    },
    abort.signal,
  ).catch(() => undefined);
  return views;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('live usage', () => {
  it('shows a growing usage of a running attempt in the run events and views', async () => {
    const h = await start();
    h.script({
      code: [
        {
          usage: [
            { id: 'm1', input: 1000, output: 100 },
            { id: 'm2', input: 2000, output: 200, cacheRead: 500 },
          ],
          // the attempt stays running while the test looks at it
          waitFor: h.gate('done'),
        },
      ],
    });
    const views = listen(h);
    await sleep(100);
    const runId = await run(h);
    const live = await h.waitFor(
      runId,
      (view) => view.groups[0]?.step === 'code' && (view.usage?.inputTokens ?? 0) >= 3500,
    );
    expect(live.finished).toBe(false);
    expect(live.groups[0]?.status).toBe('running');
    expect(live.usage).toEqual({ inputTokens: 3500, outputTokens: 300, costUsd: null });
    expect(live.groups[0]?.usage).toEqual(live.usage);
    const detail = await h.group(runId, 'login');
    expect(detail.attempts[0]?.usage).toEqual(live.usage);
    const seen = views.filter((view) => view.id === runId && view.usage !== null);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((view) => view.usage!.inputTokens)).toContain(3500);
  });

  it('ends with the usage of the result, not the sum of the messages', async () => {
    const h = await start();
    h.script({
      code: [
        {
          usage: [
            { id: 'm1', input: 1000, output: 100 },
            { id: 'm1', input: 1000, output: 150 },
            { id: 'm2', input: 2000, output: 200 },
          ],
        },
      ],
    });
    const runId = await run(h);
    const final = await h.waitFor(runId, (view) => view.finished);
    // code: 3000/350 from the result; review: the default 100/20.
    expect(final.usage).toEqual({ inputTokens: 3100, outputTokens: 370, costUsd: 0.02 });
    const detail = await h.group(runId, 'login');
    expect(detail.attempts[0]?.usage).toEqual({
      inputTokens: 3000,
      outputTokens: 350,
      costUsd: 0.01,
    });
  });

  it('sends at most a few usage changes for twenty updates in a second', async () => {
    const h = await start();
    h.script({
      code: [
        {
          usage: Array.from({ length: 20 }, (_, index) => ({
            id: `m${index}`,
            input: 10,
            output: 1,
          })),
          usageGapMs: 50,
          waitFor: h.gate('done'),
        },
      ],
    });
    const views = listen(h);
    await sleep(100);
    const runId = await run(h);
    // the agent goes on once the live usage of all twenty updates reached the stream
    await h.waitFor(runId, () =>
      views.some(
        (view) =>
          view.id === runId && view.usage?.costUsd === null && view.usage.inputTokens === 200,
      ),
    );
    h.open('done');
    await h.waitFor(runId, (view) => view.finished);
    const live = new Set(
      views
        .filter((view) => view.id === runId && view.usage !== null && view.usage.costUsd === null)
        .map((view) => view.usage!.inputTokens),
    );
    expect(live.size).toBeGreaterThan(0);
    expect(live.size).toBeLessThanOrEqual(3);
  });

  it('keeps the usage of a running attempt over a daemon restart', async () => {
    const h = await start();
    h.script({ code: [{ usage: [{ input: 4000, output: 400 }], hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => (view.usage?.inputTokens ?? 0) === 4000);
    h.script({ code: [{}] });
    await h.restart();
    const after = await h.status(runId);
    expect(after.groups[0]).toMatchObject({ status: 'failed', reason: 'interrupted' });
    expect(after.usage).toEqual({ inputTokens: 4000, outputTokens: 400, costUsd: null });
    const detail = await h.group(runId, 'login');
    expect(detail.attempts[0]?.usage).toEqual(after.usage);
  });

  it('keeps the usage of an attempt cancelled during the step', async () => {
    const h = await start();
    h.script({ code: [{ usage: [{ input: 4000, output: 400 }], hang: true }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => (view.usage?.inputTokens ?? 0) === 4000);
    await h.call('cancel', { runId, group: 'login' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups[0]?.status).toBe('cancelled');
    expect(final.usage).toEqual({ inputTokens: 4000, outputTokens: 400, costUsd: null });
    const detail = await h.group(runId, 'login');
    expect(detail.attempts[0]).toMatchObject({
      verdict: null,
      usage: { inputTokens: 4000, outputTokens: 400 },
    });
  });
});
