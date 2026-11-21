import { afterEach, describe, expect, it } from 'vitest';

import { startWebServer, type WebServer } from '../../src/presentation/web/server.ts';
import type { GroupView, RunCreated } from '../../src/presentation/ipc/contract/index.ts';
import {
  MANUAL_CONFIG,
  harness,
  settle,
  startRun,
  until,
  type Harness,
} from '../daemon/harness.ts';
import { liveStatus, openLive, type LiveProbe } from '../fixtures/live.ts';

let h: Harness | null = null;
let web: WebServer | null = null;
const probes: LiveProbe[] = [];

afterEach(async () => {
  for (const probe of probes.splice(0)) probe.close();
  await web?.close();
  await h?.close();
  web = null;
  h = null;
});

async function setup(options: { auth?: 'none' } = {}): Promise<{
  h: Harness;
  web: WebServer;
  base: string;
  headers: Record<string, string>;
}> {
  h = await harness(MANUAL_CONFIG);
  web = await startWebServer({ socket: h.socket, port: 0, repository: h.repo, ...options });
  const headers: Record<string, string> = web.token === null ? {} : { 'x-aip-token': web.token };
  return { h, web, base: `http://127.0.0.1:${web.port}`, headers };
}

async function live(base: string, headers: Record<string, string>): Promise<LiveProbe> {
  const probe = await openLive(base, headers);
  probes.push(probe);
  return probe;
}

const topicsOf = (probe: LiveProbe, id: string) =>
  probe.messages.filter((message) => message.id === id);

interface TranscriptData {
  cursor: number;
  running: boolean;
  entries: unknown[];
}

describe('live connection of the panel', () => {
  it('checks the access like a request of the API before it opens', async () => {
    const { base, headers } = await setup();
    expect(await liveStatus(base)).toBe(401);
    expect(await liveStatus(base, { ...headers, origin: 'http://evil.example' })).toBe(403);
    expect(await liveStatus(base, { cookie: `aip_token=${headers['x-aip-token']}` })).toBe(101);
    expect(await liveStatus(base, headers)).toBe(101);
    // the old stream is gone, and nothing but the live path is upgraded
    expect((await fetch(`${base}/api/events`, { headers })).status).toBe(404);
    const other = new Promise<number>((resolve, reject) => {
      const url = `${base.replace(/^http/, 'ws')}/api/runs`;
      void import('ws').then(({ WebSocket }) => {
        const socket = new WebSocket(url, { headers });
        socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
        socket.on('error', reject);
      });
    });
    expect(await other).toBe(404);
  });

  it('opens without a token when the panel has none', async () => {
    const { base } = await setup({ auth: 'none' });
    expect(await liveStatus(base)).toBe(101);
    expect(await liveStatus(base, { origin: 'http://evil.example' })).toBe(403);
  });

  it('sends the snapshot first, then the runs, and never the log events', async () => {
    const { h, base, headers } = await setup();
    const probe = await live(base, headers);
    await probe.until('"snapshot"');
    expect(probe.messages[0]).toMatchObject({ event: 'snapshot', runs: [] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'merged');
    await probe.message('the run', (message) => message.event === 'run');
    await settle(h);
    expect(probe.messages.some((message) => message.event === 'log')).toBe(false);
  });

  it('sends the log of an attempt as it grows and ends the subscription with the attempt', async () => {
    const { h, base, headers } = await setup();
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'running');
    const probe = await live(base, headers);
    const topic = { kind: 'transcript', runId, group: 'login', seq: 1 };
    probe.send({ op: 'subscribe', id: 't1', topic });
    const first = await probe.message('the first part', (message) => message.id === 't1');
    expect(first).toMatchObject({ event: 'topic', data: { running: true } });
    h.open('code');
    await probe.message(
      'the end of the attempt',
      (message) => message.id === 't1' && !(message.data as TranscriptData).running,
    );
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'merged');
    await settle(h);
    const parts = topicsOf(probe, 't1').map((message) => message.data as TranscriptData);
    expect(parts.at(-1)?.running).toBe(false);
    expect(parts.slice(0, -1).every((part) => part.running)).toBe(true);
    // the parts are the whole log once, in order
    const whole = (await h.call('transcript', { runId, group: 'login', seq: 1 })) as TranscriptData;
    expect(parts.flatMap((part) => part.entries)).toEqual(whole.entries);
    expect(parts.at(-1)?.cursor).toBe(whole.cursor);
    // read on from a cursor: only what comes after it
    probe.send({ op: 'subscribe', id: 't2', topic: { ...topic, after: parts[0]?.cursor } });
    const rest = await probe.message('the rest', (message) => message.id === 't2');
    expect((rest.data as TranscriptData).entries).toEqual(
      parts.slice(1).flatMap((part) => part.entries),
    );
  });

  it('sends the view of a group again when the run changes, and only when it differs', async () => {
    const { h, base, headers } = await setup();
    h.script({ code: [{ waitFor: h.gate('code') }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'login', task: 'x' }],
    })) as RunCreated;
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'running');
    // the diff of a group is counted in the background: the first view has none until it is ready
    await until('the diff of the group', async () => {
      const view = (await h.call('group', { runId, group: 'login' })) as GroupView;
      return view.diff !== null;
    });
    const probe = await live(base, headers);
    probe.send({ op: 'subscribe', id: 'g1', topic: { kind: 'group', runId, group: 'login' } });
    const first = await probe.message('the group', (message) => message.id === 'g1');
    const asked = (await (
      await fetch(`${base}/api/runs/${runId}/groups/login?tail=200`, { headers })
    ).json()) as GroupView;
    // the same view as the API gives (the duration of a running attempt goes on between the two)
    const data = first.data as GroupView;
    expect(Object.keys(data)).toEqual(Object.keys(asked));
    expect({ ...data, attempts: data.attempts.map((attempt) => attempt.seq) }).toEqual({
      ...asked,
      attempts: asked.attempts.map((attempt) => attempt.seq),
    });
    h.open('code');
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'merged');
    await probe.message(
      'the merged group',
      (message) => message.id === 'g1' && (message.data as GroupView).status === 'merged',
    );
    await settle(h);
    const sent = topicsOf(probe, 'g1').map((message) => JSON.stringify(message.data));
    expect(new Set(sent).size).toBe(sent.length);
    // after the unsubscription nothing comes under this id
    probe.send({ op: 'unsubscribe', id: 'g1' });
    await settle(h);
    const before = topicsOf(probe, 'g1').length;
    await h.call('retry', { runId, group: 'login' }).catch(() => undefined);
    await settle(h);
    expect(topicsOf(probe, 'g1')).toHaveLength(before);
  });

  it('closes a connection that stopped answering the pings', async () => {
    h = await harness(MANUAL_CONFIG);
    web = await startWebServer({
      socket: h.socket,
      port: 0,
      repository: h.repo,
      live: { pingMs: 30 },
    });
    const { WebSocket } = await import('ws');
    const open = (autoPong: boolean) =>
      new WebSocket(`ws://127.0.0.1:${web?.port}/api/ws`, {
        headers: { 'x-aip-token': web?.token ?? '' },
        autoPong,
      });
    const silent = open(false);
    const answering = open(true);
    const closed = await new Promise<number>((resolve) => silent.on('close', resolve));
    expect(closed).toBe(1006);
    expect(answering.readyState).toBe(answering.OPEN);
    answering.close();
  });

  it('answers a wrong message with an error and keeps the connection', async () => {
    const { h, base, headers } = await setup();
    const probe = await live(base, headers);
    await probe.until('"snapshot"');
    probe.send({ op: 'subscribe', id: 'x1', topic: { kind: 'nope' } });
    probe.send('not json');
    probe.send({
      op: 'subscribe',
      id: 'x2',
      topic: { kind: 'group', runId: 'nope', group: 'login' },
    });
    expect(await probe.message('x1', (message) => message.id === 'x1')).toMatchObject({
      event: 'topic_error',
      code: 'live.invalid',
    });
    expect(await probe.message('x2', (message) => message.id === 'x2')).toMatchObject({
      event: 'topic_error',
    });
    const asked = await fetch(`${base}/api/runs/nope/groups/login?tail=200`, { headers });
    const refused = (await asked.json()) as { error: string };
    expect(topicsOf(probe, 'x2')[0]?.error).toBe(refused.error);
    // the events still come
    await h.call('tag_add', { repository: h.repo, name: 'later' });
    expect(await probe.until('"name":"later"')).toContain('"name":"later"');
  });

  it('sends the providers of the project and closes a connection that sends too much', async () => {
    const { base, headers } = await setup();
    const probe = await live(base, headers);
    probe.send({ op: 'subscribe', id: 'p1', topic: { kind: 'providers' } });
    const first = await probe.message('the providers', (message) => message.id === 'p1');
    const asked = await (await fetch(`${base}/api/config/providers`, { headers })).json();
    expect(first.data).toEqual(asked);
    probe.send({ op: 'subscribe', id: 'big', topic: { kind: 'group', runId: 'x'.repeat(5000) } });
    expect(await probe.closed).toBe(1009);
  });
});
