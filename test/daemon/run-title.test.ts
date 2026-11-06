import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type RunCreated,
  type RunView,
  type StreamEvent,
} from '../../src/protocol/index.ts';

import { MANUAL_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function create(h: Harness, extra: Record<string, unknown> = {}): Promise<string> {
  const { runId } = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    task: 'Добавить флаг --json\nподробности',
    ...extra,
  })) as RunCreated;
  return runId;
}

describe('run_title', () => {
  it('renames a finished run, keeps the name, survives a restart and reaches subscribers', async () => {
    const h = (current = await harness(MANUAL_CONFIG));
    h.script({ naming: { answer: '{"title": "Модель", "name": "model-name"}' } });
    const runId = await create(h);
    const done = await h.waitFor(runId, (view) => view.finished && view.name !== null);
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    await until('the snapshot', () => events.length > 0);
    const view = (await h.call('run_title', { runId, title: '  Своё название ' })) as RunView;
    expect(view).toMatchObject({ title: 'Своё название', name: done.name });
    await until('the run event', () =>
      events.some(
        (event) =>
          event.event === 'run' && (event.run as unknown as RunView).title === 'Своё название',
      ),
    );
    await h.restart();
    expect((await h.status(runId)).title).toBe('Своё название');
    void ended;
  });

  it('refuses an unknown run', async () => {
    const h = (current = await harness());
    await expect(h.call('run_title', { runId: 'nope', title: 'x' })).rejects.toThrow('unknown run');
  });

  it('is not overwritten by a late answer of the naming model', async () => {
    const h = (current = await harness(MANUAL_CONFIG));
    h.script({
      naming: {
        waitFor: h.gate('naming'),
        answer: '{"title": "Модель", "name": "model-name"}',
      },
      code: [{ waitFor: h.gate('code') }],
    });
    const runId = await create(h);
    await h.waitFor(runId, (view) => view.groups[0]?.status === 'running');
    await h.call('run_title', { runId, title: 'Ручное' });
    h.open('naming');
    const named = await h.waitFor(runId, (view) => (view.usage?.costUsd ?? 0) >= 0.002);
    h.open('code');
    expect(named).toMatchObject({ title: 'Ручное', name: null });
  });
});
