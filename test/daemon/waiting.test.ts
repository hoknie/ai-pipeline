import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  subscribe,
  type RunView,
  type StreamEvent,
} from '../../src/protocol/index.ts';

import { writeConfigDirectory } from '../fixtures/config.ts';

import { WORKFLOW_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const LIMITED = WORKFLOW_CONFIG.replace(
  'coder: { name: Кодировщик }',
  'coder: { name: Кодировщик, max: 1 }',
);

const row = (view: RunView, slug: string) => view.groups.find((group) => group.slug === slug);

describe('groups waiting for a specialist', () => {
  it('shows the second group as waiting while the only coder works, then runs it', async () => {
    const h = (current = await harness(LIMITED));
    h.script({ code: [{ waitFor: h.gate('login') }, {}] });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    const { runId } = await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [
        { title: 'login', task: 'x' },
        { title: 'signup', task: 'y' },
      ],
    });
    const waiting = await h.waitFor(runId, (view) => row(view, 'signup')?.status === 'waiting');
    expect(row(waiting, 'signup')?.wait).toEqual({
      reason: 'specialist',
      specialist: 'coder',
      name: 'Кодировщик',
      max: 1,
    });
    expect(row(waiting, 'login')?.status).toBe('running');
    expect(waiting.state).toBe('active');
    expect(waiting.counts).toContain('waiting 1');
    const group = await h.group(runId, 'signup');
    expect(group).toMatchObject({ status: 'waiting', wait: { reason: 'specialist' } });
    h.open('login');

    const running = await h.waitFor(runId, (view) => row(view, 'signup')?.status === 'running');
    expect(row(running, 'signup')?.wait).toBeNull();
    const done = await h.waitFor(runId, (view) => view.finished);
    expect(done.groups.every((entry) => entry.wait === null)).toBe(true);

    // subscribers saw the run change to waiting and back
    const signupEvents = () =>
      events.flatMap((event) =>
        event.event === 'run'
          ? [
              (event.run as unknown as RunView).groups.find((entry) => entry.slug === 'signup')
                ?.status,
            ]
          : [],
      );
    await until('the event of the finished run', () => signupEvents().includes('merged'));
    const seen = signupEvents();
    expect(seen).toContain('waiting');
    expect(seen.indexOf('waiting')).toBeLessThan(seen.lastIndexOf('running'));
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });

  it('sends queue events when the waiting set of a run changes, and nothing else', async () => {
    const h = (current = await harness(LIMITED));
    h.script({ code: [{ waitFor: h.gate('login') }, {}] });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    const { runId } = await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [
        { title: 'login', task: 'x' },
        { title: 'signup', task: 'y' },
      ],
    });
    await h.waitFor(runId, (view) => row(view, 'signup')?.status === 'waiting');
    const queueWaits = () =>
      events.flatMap((event) =>
        event.event === 'queue'
          ? [
              (
                (
                  event.queue as {
                    runs?: { id: string; waiting?: { group: string; wait: unknown }[] }[];
                  }
                ).runs ?? []
              ).find((entry) => entry.id === runId)?.waiting ?? [],
            ]
          : [],
      );
    const firstWait = () =>
      queueWaits().findIndex((list) =>
        list.some(
          (entry) =>
            entry.group === 'signup' && (entry.wait as { reason: string }).reason === 'specialist',
        ),
      );
    await until('a queue event with the waiting group', () => firstWait() >= 0);
    const withWait = firstWait();
    expect(withWait).toBeGreaterThanOrEqual(0);

    h.open('login');
    await h.waitFor(runId, (view) => row(view, 'signup')?.status === 'running');
    await until(
      'a queue event without the waiting group',
      () =>
        queueWaits()
          .at(-1)
          ?.some((entry) => entry.group === 'signup') === false,
    );
    const lists = queueWaits();
    const last = lists.findLastIndex((list) => list.some((entry) => entry.group === 'signup'));
    expect(last).toBeGreaterThanOrEqual(withWait);
    expect(lists.at(-1)?.some((entry) => entry.group === 'signup')).toBe(false);
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });

  it('tells the run of another task when a specialist of the first run is freed', async () => {
    const h = (current = await harness(LIMITED));
    // The first coder works until the test lets it go: a fixed delay may end inside the quiet window
    // below on a loaded machine and send a real event for the waiting run.
    h.script({ code: [{ waitFor: h.gate('first') }, {}, {}] });
    const events: StreamEvent[] = [];
    const ended = subscribe(h.socket, (line) =>
      events.push(streamEventSchema.parse(JSON.parse(line))),
    );
    const first = await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    });
    await h.waitFor(first.runId, (view) => row(view, 'login')?.status === 'running');
    const other = join(h.repo, '..', 'other');
    mkdirSync(other, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', other]);
    writeFileSync(join(other, 'x'), '1');
    writeConfigDirectory(other, LIMITED);
    execFileSync('git', ['-C', other, 'add', '-A']);
    execFileSync('git', [
      '-C',
      other,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e.x',
      'commit',
      '-q',
      '-m',
      'i',
    ]);
    const second = await startRun(h, {
      repository: other,
      workflow: 'feature',
      groups: [{ title: 'signup', task: 'y' }],
    });
    const secondId = second.runId;
    await h.waitFor(secondId, (view) => row(view, 'signup')?.status === 'waiting');
    // The diff statistics of a run arrive later and send one more event; on a loaded machine that
    // takes longer than any fixed pause, so wait until the stream stays quiet.
    for (let seen = -1; seen !== events.length;) {
      seen = events.length;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const statusesOfSecond = () =>
      events.flatMap((event) =>
        event.event === 'run' && (event.run as { id: string }).id === secondId
          ? [
              (event.run as unknown as RunView).groups.find((entry) => entry.slug === 'signup')
                ?.status,
            ]
          : [],
      );
    // requests that change nothing, and the first run working, send no events for the waiting run
    const before = statusesOfSecond().length;
    await h.status(secondId);
    await h.group(secondId, 'signup');
    await h.call('status', { runId: first.runId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(statusesOfSecond()).toHaveLength(before);
    h.open('first');
    await h.waitFor(secondId, (view) => row(view, 'signup')?.status === 'running');
    // the request answers before the event reaches the subscriber: wait for the event itself
    await until('the event of the second run running', () =>
      statusesOfSecond().includes('running'),
    );
    const seen = statusesOfSecond();
    expect(seen.indexOf('waiting')).toBeLessThan(seen.lastIndexOf('running'));
    await h.close();
    current = null;
    expect(await ended).toBe('closed');
  });
});
