import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  streamEventSchema,
  type ObserversView,
  type QueueView,
  type RunCreated,
  type RunView,
  type StreamEvent,
} from '../../src/presentation/ipc/contract/index.ts';
import { subscribe } from '../../src/presentation/ipc/client/index.ts';

import {
  CODE_ONLY_CONFIG,
  PIPELINE_CONFIG,
  harness,
  settle,
  startRun,
  until,
  type Harness,
} from './harness.ts';

const fakeClaude = join(import.meta.dirname, '..', 'fakes', 'claude');

let current: Harness | null = null;
/** The clock of the daemon runs this many ms ahead of the wall clock. */
let skewMs = 0;

afterEach(async () => {
  await current?.close();
  current = null;
});

const FAIL = { exitCode: 1, noReport: true };
const GROUPS = [{ title: 'Login', task: 'login' }];

/** How long a task waits before an observer takes its incident again after a failed repair. */
const REPAIR_PAUSE_MS = 300_000;

async function start(config = CODE_ONLY_CONFIG): Promise<Harness> {
  current = await harness(config);
  return current;
}

/** A daemon with a movable clock: the tests shift it over the pause after a failed repair. */
async function startTimed(config = CODE_ONLY_CONFIG): Promise<Harness> {
  skewMs = 0;
  current = await harness(config, {}, { now: () => Date.now() + skewMs });
  return current;
}

/** The daemon wakes up as it does after a timer: schedules and lets the observers look again. */
async function wake(h: Harness): Promise<void> {
  const { engine } = h.running.application.services.runs;
  await engine.serial(() => engine.wake());
}

type Result = { ok: true; view: ObserversView } | { ok: false; errors: unknown[] };

/** Saves settings of the observers; `projects` defaults to the repository of the harness. */
async function configure(h: Harness, settings: Record<string, unknown> = {}): Promise<Result> {
  await h.call('repository_add', { path: h.repo });
  return (await h.call('observers_set', {
    settings: { enabled: true, projects: [{ repository: h.repo, maxWorkers: null }], ...settings },
  })) as Result;
}

async function launch(h: Harness, groups = GROUPS): Promise<string> {
  const { runId } = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups,
  })) as RunCreated;
  return runId;
}

const retry = (group = 'login') => ({
  toolCalls: [{ name: 'swarm_repair_retry', arguments: { group } }],
});

function fakeLines(h: Harness, file: string): Record<string, any>[] {
  const path = join(h.fakeState, file);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, any>);
}

const toolResults = (h: Harness) => fakeLines(h, 'tools.jsonl').map((line) => line.result);

function listen(h: Harness): StreamEvent[] {
  const events: StreamEvent[] = [];
  void subscribe(h.socket, (line) => events.push(streamEventSchema.parse(JSON.parse(line))));
  return events;
}

const incidents = (events: StreamEvent[]) => events.filter((event) => event.event === 'incident');

describe('Repair status', () => {
  it('shows a failed run as repair while the observer works, then as it was', async () => {
    const h = await start();
    h.script({ code: [FAIL, {}], repair: [{ waitFor: h.gate('repair'), ...retry() }] });
    await configure(h);
    const runId = await launch(h);
    const working = await h.waitFor(
      runId,
      (view) => view.repair?.incident !== null && view.repair?.incident !== undefined,
    );
    expect(working.state).toBe('repair');
    expect(working.finishedAt).toBeNull();
    expect(working.repair).toMatchObject({
      allowed: true,
      active: true,
      repairs: 1,
      incident: { kind: 'failed', group: 'login' },
    });
    expect(working.system.some((group) => group.kind === 'repair')).toBe(true);
    const observers = (await h.call('observers', {})) as ObserversView;
    expect(observers.workers.running).toMatchObject([{ runId, incident: { group: 'login' } }]);
    h.open('repair');
    const done = await h.waitFor(runId, (view) => view.finished);
    expect(done.state).toBe('finished');
    expect(done.repair).toMatchObject({ active: false, incident: null, repairs: 1 });
  });

  it('keeps a run nobody can take in its old state', async () => {
    const h = await start();
    h.script({ code: [FAIL] });
    const runId = await launch(h);
    const failed = await h.waitFor(runId, (view) => view.finished);
    expect(failed.state).toBe('failed');
    expect(failed.repair).toMatchObject({ active: false });
  });

  it('does not take an incident of a run a person forbade, and takes it back on request', async () => {
    const h = await start();
    h.script({ code: [FAIL, {}], repair: [retry()] });
    await configure(h);
    const runId = await launch(h);
    await h.call('run_observer', { runId, enabled: false });
    const failed = await h.waitFor(runId, (view) => view.finished);
    await settle(h);
    expect(failed.state).toBe('failed');
    expect(failed.repair).toMatchObject({ allowed: false, active: false });
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(0);
    await h.call('run_observer', { runId, enabled: true });
    const repaired = await h.waitFor(runId, (view) => view.finished && view.state === 'finished');
    expect(repaired.repair?.repairs).toBe(1);
  });

  it('stops after maxRepairs and leaves the incident to a person', async () => {
    const h = await start();
    h.script({ code: [FAIL], repair: [retry()] });
    await configure(h, { maxRepairs: 2 });
    const runId = await launch(h);
    await h.waitFor(runId, (view) => view.repair?.repairs === 2 && view.finished);
    await settle(h);
    const view = await h.status(runId);
    expect(view.repair).toMatchObject({ repairs: 2, active: false });
    expect(view.state).toBe('failed');
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(2);
  });

  it('gives the repair back when the observer cannot report, and takes the incident after the pause', async () => {
    const h = await startTimed();
    h.script({ code: [FAIL, {}], repair: [FAIL, retry()] });
    await configure(h);
    const runId = await launch(h);
    await until('the failed repair', () =>
      fakeLines(h, 'calls.jsonl').some((call) => call.step === 'repair'),
    );
    const crashed = await h.waitFor(
      runId,
      (view) => view.repair?.incident === null && view.repair?.repairs === 0,
    );
    expect(crashed.repair).toMatchObject({ repairs: 0, incident: null });
    await settle(h);
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(1);
    expect(h.running.application.services.runs.engine.hasWakeTimer()).toBe(true);
    // Restarting the daemon restores the wake-up timer for the paused finished run.
    await h.restart();
    expect(h.running.application.services.runs.engine.hasWakeTimer()).toBe(true);
    skewMs += REPAIR_PAUSE_MS + 60_000;
    await wake(h);
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
    expect(view.repair?.repairs).toBe(1);
  });
});

describe('Unavailable runtime', () => {
  const callsOf = (h: Harness, step: string) =>
    fakeLines(h, 'calls.jsonl').filter((call) => call.step === step);

  it('does not spend repairs while claude is off, and takes the incident once it is on', async () => {
    current = await harness(CODE_ONLY_CONFIG, { AIP_CLAUDE_BIN: undefined });
    const h = current;
    // no `enabled` and no AIP_CLAUDE_BIN: claude is off, for the group and for the observer
    h.script({ code: [{}], repair: [retry()] });
    await configure(h, { maxRepairs: 2 });
    const runId = await launch(h);
    const failed = await h.waitFor(runId, (view) => view.finished);
    await settle(h);
    expect(failed.groups[0]).toMatchObject({
      status: 'failed',
      reason: 'runtime disabled: claude',
    });
    const waiting = await h.status(runId);
    expect(waiting.state).toBe('failed');
    expect(waiting.repair).toMatchObject({ active: false, repairs: 0, incident: null });
    expect((await h.group(runId, 'login')).attempts).toHaveLength(1);
    expect(callsOf(h, 'repair')).toHaveLength(0);
    expect(((await h.call('observers', {})) as ObserversView).workers.waiting).toBe(0);

    await h.call('config_settings', {
      repository: h.repo,
      values: { 'runtimes.claude.enabled': true, 'runtimes.claude.command': fakeClaude },
      revision: null,
      level: 'global',
    });
    const done = await h.waitFor(runId, (view) => view.finished && view.state === 'finished');
    expect(done.repair?.repairs).toBe(1);
    expect(callsOf(h, 'repair')).toHaveLength(1);
  });

  it('does not repair a group whose command is not found', async () => {
    current = await harness(
      CODE_ONLY_CONFIG.replace(
        'coder: { name: Coder }',
        'coder: { name: Coder, runtime: opencode }',
      ),
      { AIP_OPENCODE_BIN: '/nonexistent/opencode' },
    );
    const h = current;
    h.script({ repair: [retry()] });
    await configure(h);
    const runId = await launch(h);
    const failed = await h.waitFor(runId, (view) => view.finished);
    await settle(h);
    expect(failed.groups[0]).toMatchObject({
      status: 'failed',
      reason: 'runtime not found: opencode',
    });
    const view = await h.status(runId);
    expect(view.repair).toMatchObject({ active: false, repairs: 0 });
    expect(callsOf(h, 'repair')).toHaveLength(0);
  });
});

describe('Pause after an observer timeout', () => {
  const callsOf = (h: Harness) =>
    fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair');

  it('does not call the agent again during the pause, and takes the incident after it', async () => {
    const h = await startTimed();
    h.script({ code: [FAIL, {}], repair: [{ hang: true }, retry()] });
    await configure(h, { specialist: { timeout: '1s' } });
    const runId = await launch(h);
    await until('the repair call', () => callsOf(h).length === 1);
    // The agent hangs until the low timeout of the profile: the repair is given back and paused.
    const failed = await h.waitFor(
      runId,
      (view) => view.repair?.incident === null && view.repair?.repairs === 0,
    );
    expect(failed.repair).toMatchObject({ repairs: 0, incident: null });
    await settle(h);
    expect((await h.status(runId)).state).toBe('repair');
    expect(callsOf(h)).toHaveLength(1);
    expect(h.running.application.services.runs.engine.hasWakeTimer()).toBe(true);
    // The pause holds while the settings return to a timeout the agent can work under: the next
    // call starts only after it, so the low timeout of the first failure stays alone in the run.
    await configure(h, { specialist: { timeout: '30s' } });
    expect(callsOf(h)).toHaveLength(1);
    skewMs += REPAIR_PAUSE_MS + 60_000;
    await wake(h);
    const done = await h.waitFor(runId, (run) => run.finished && run.state === 'finished', 30_000);
    expect(done.repair).toMatchObject({ repairs: 1, incident: null });
    expect(callsOf(h)).toHaveLength(2);
  });

  it('keeps a queued task waiting for the observer during the pause', async () => {
    const h = await startTimed();
    h.script({ code: [FAIL, {}], repair: [{ hang: true }, retry()] });
    await configure(h, { specialist: { timeout: '1s' } });
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: GROUPS,
      title: 'one',
    });
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    await until('the run', async () => ((await h.call('status', {})) as RunView[]).length > 0);
    const runId = ((await h.call('status', {})) as RunView[])[0]!.id;
    await until('the repair call', () => callsOf(h).length === 1);
    await h.waitFor(runId, (view) => view.repair?.incident === null && view.repair?.repairs === 0);
    await settle(h);
    // The pause is invisible to the queue: as while the agent works, the failed run waits
    // off the places under `skipFailed`, the queue does not stop for it, and the run is
    // not shown as failed.
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.stop).toBeNull();
    expect(queue.skipped.map((run) => run.id)).toContain(runId);
    expect((await h.status(runId)).state).toBe('repair');
    expect(h.running.application.services.runs.engine.hasWakeTimer()).toBe(true);
    // A timeout the agent can work under while the pause still holds, so the next call finishes.
    await configure(h, { specialist: { timeout: '30s' } });
    expect(callsOf(h)).toHaveLength(1);
    skewMs += REPAIR_PAUSE_MS + 60_000;
    await wake(h);
    await h.waitFor(runId, (run) => run.finished && run.state === 'finished', 30_000);
    expect(callsOf(h)).toHaveLength(2);
  });
});

describe('Incident event', () => {
  it('sends one incident event, also where no observer is connected', async () => {
    const h = await start();
    h.script({ code: [FAIL] });
    const events = listen(h);
    const runId = await launch(h);
    await h.waitFor(runId, (view) => view.finished);
    await until('the incident', () => incidents(events).length > 0);
    await settle(h);
    expect(incidents(events)).toHaveLength(1);
    expect(incidents(events)[0]).toMatchObject({
      runId,
      repository: h.repo,
      incident: { group: 'login', kind: 'failed' },
    });
  });

  it('finds the incident of a run that failed while the daemon was down', async () => {
    const h = await start();
    h.script({ code: [{ hang: true }, {}], repair: [retry()] });
    const runId = await launch(h);
    await until('the agent', () =>
      fakeLines(h, 'calls.jsonl').some((call) => call.step === 'code'),
    );
    await configure(h);
    await h.restart();
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished', 30_000);
    expect(view.repair?.repairs).toBe(1);
  });
});

describe('Paused tasks and the queue', () => {
  it('gives the repair back when a pause stops it, and takes nothing while paused', async () => {
    const h = await start();
    h.script({ code: [FAIL, {}], repair: [{ waitFor: h.gate('never') }, retry()] });
    await configure(h);
    const runId = await launch(h);
    await until('the observer', () =>
      fakeLines(h, 'calls.jsonl').some((call) => call.step === 'repair'),
    );
    await h.call('run_pause', { runId });
    const paused = await h.waitFor(runId, (view) => view.state === 'paused');
    expect(paused.repair).toMatchObject({ repairs: 0, incident: null, active: false });
    expect(paused.system.find((group) => group.kind === 'repair')?.status).toBe('cancelled');
    await settle(h);
    expect((await h.status(runId)).state).toBe('paused');
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(1);
  });

  it('lets a run an observer takes pass without stopping the queue', async () => {
    const h = await start();
    h.script({
      code: [FAIL, {}],
      repair: [{ waitFor: h.gate('repair'), ...retry() }],
    });
    await configure(h);
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: GROUPS,
      title: 'one',
    });
    await h.call('queue_start', { repository: h.repo });
    await until('the repair', async () => {
      const runs = (await h.call('status', {})) as RunView[];
      return runs.some((view) => view.state === 'repair');
    });
    await settle(h);
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.stop).toBeNull();
    expect(queue.skipped).toEqual([]);
    h.open('repair');
    await until('the end', async () => {
      const runs = (await h.call('status', {})) as RunView[];
      return runs.every((view) => view.finished && view.state === 'finished');
    });
  });

  it('stops the queue as before when the project is not connected', async () => {
    const h = await start();
    h.script({ code: [FAIL] });
    await configure(h, { projects: [] });
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: GROUPS,
      title: 'one',
    });
    await h.call('queue_start', { repository: h.repo });
    await until('the queue stop', async () => {
      const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
      return queue.stop !== null;
    });
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.stop).not.toBeNull();
    expect(queue.status).not.toBe('running');
  });
});

describe('Task outside the queue', () => {
  it('notices a failed run without a restart or a saved setting', async () => {
    const h = await start();
    h.script({ code: [FAIL, {}], repair: [retry()] });
    await configure(h);
    const queue = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(queue.items).toHaveLength(0);
    const runId = await launch(h);
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
    expect(view.repair?.repairs).toBe(1);
  });
});

describe('Observer actions', () => {
  it('answers a question with the author observer', async () => {
    const h = await start();
    h.script({
      code: [{ verdict: 'needs_human', questions: [{ text: 'Which option?' }] }, {}],
      repair: [
        {
          toolCalls: [
            { name: 'swarm_repair_answer', arguments: { group: 'login', answer: 'First' } },
          ],
        },
      ],
    });
    await configure(h);
    const runId = await launch(h);
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
    expect(view.decisions.map((decision) => decision.by)).toEqual(['observer']);
    expect(view.decisions[0]?.answer).toBe('First');
  });

  it('cancels a group with a reason that shows in the group', async () => {
    const h = await start();
    h.script({
      code: [{ verdict: 'needs_human', questions: [{ text: 'What to do?' }] }],
      repair: [
        {
          toolCalls: [
            { name: 'swarm_repair_cancel', arguments: { group: 'login', reason: 'not needed' } },
          ],
        },
      ],
    });
    await configure(h);
    const runId = await launch(h);
    const view = await h.waitFor(
      runId,
      (run) => run.finished && run.groups[0]?.status === 'cancelled',
    );
    expect((await h.group(runId, 'login')).reason).toBe('not needed');
    expect(view.state).toBe('cancelled');
  });

  it('cancels the whole task and keeps the reason', async () => {
    const h = await start();
    h.script({
      code: [FAIL],
      repair: [{ toolCalls: [{ name: 'swarm_repair_cancel', arguments: { reason: 'dead end' } }] }],
    });
    await configure(h);
    const runId = await launch(h);
    const view = await h.waitFor(runId, (run) => run.repair?.cancelReason === 'dead end');
    expect(view.repair?.cancelReason).toBe('dead end');
    await h.waitFor(runId, (run) => run.finished);
  });

  it('puts a restarted run back in the queue like a retry of a person', async () => {
    const h = await start();
    h.script({
      code: [FAIL, { waitFor: h.gate('second') }],
      repair: [{ waitFor: h.gate('repair'), ...retry() }],
    });
    await configure(h);
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: GROUPS,
      title: 'one',
    });
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    await until('the run', async () => ((await h.call('status', {})) as RunView[]).length > 0);
    const runId = ((await h.call('status', {})) as RunView[])[0]!.id;
    await h.waitFor(
      runId,
      (run) => run.repair?.incident !== null && run.repair?.incident !== undefined,
    );
    const during = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(during.skipped.map((run) => run.id)).toContain(runId);
    expect(during.runs.map((run) => run.id)).not.toContain(runId);
    h.open('repair');
    await h.waitFor(runId, (run) => run.groups[0]?.status === 'running');
    const back = (await h.call('queue', { repository: h.repo })) as QueueView;
    expect(back.runs.map((run) => run.id)).toContain(runId);
    expect(back.skipped.map((run) => run.id)).not.toContain(runId);
    expect(back.runs.find((run) => run.id === runId)?.priority).toBe(false);
    h.open('second');
    await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
  });

  it('waits frozen, first in the queue, when an observer retries with every place taken', async () => {
    const h = await start();
    h.script({
      code: [FAIL, { waitFor: h.gate('b') }, {}],
      repair: [{ waitFor: h.gate('repair'), ...retry() }],
    });
    await configure(h);
    for (const title of ['one', 'two']) {
      await h.call('queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        groups: GROUPS,
        title,
        allowDuplicate: true,
      });
    }
    await h.call('queue_settings', { repository: h.repo, skipFailed: true });
    await h.call('queue_start', { repository: h.repo });
    const placed = async (done: (queue: QueueView) => boolean): Promise<QueueView> => {
      let last = (await h.call('queue', { repository: h.repo })) as QueueView;
      await until('the queue', async () => {
        last = (await h.call('queue', { repository: h.repo })) as QueueView;
        return done(last);
      });
      return last;
    };
    const busy = await placed((queue) => queue.skipped.length === 1 && queue.runs.length === 1);
    const a = busy.skipped[0]!.id;
    const b = busy.runs[0]!.id;
    await h.waitFor(
      a,
      (run) => run.repair?.incident !== null && run.repair?.incident !== undefined,
    );
    const agentCalls = () => fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'code');
    await until('both tasks started', () => agentCalls().length === 2);
    h.open('repair');
    const frozen = await h.waitFor(a, (run) => run.hold === 'frozen');
    expect(frozen.finished).toBe(false);
    const queue = await placed((view) => view.items[0]?.run === a);
    expect(queue.runs.map((run) => run.id)).toEqual([b]);
    expect(queue.runs[0]!.priority).toBe(false);
    expect(queue.skipped).toEqual([]);
    expect(queue.items[0]).toMatchObject({ run: a, hold: 'frozen' });
    expect((await h.status(b)).hold).toBeNull();
    await settle(h);
    expect(agentCalls()).toHaveLength(2);
    h.open('b');
    const done = await h.waitFor(a, (run) => run.finished && run.state === 'finished');
    expect(done.hold).toBeNull();
  });

  it('lets the autopilot answer before an observer sees the question', async () => {
    const h = await start();
    h.script({
      code: [{ verdict: 'needs_human', questions: [{ text: 'How?' }] }, {}],
      repair: [retry()],
    });
    await configure(h);
    const events = listen(h);
    await h.call('queue_settings', { repository: h.repo, autoAnswer: true });
    await h.call('queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      groups: GROUPS,
      title: 'one',
    });
    await h.call('queue_start', { repository: h.repo });
    await until('the run', async () => ((await h.call('status', {})) as RunView[]).length > 0);
    const runId = ((await h.call('status', {})) as RunView[])[0]!.id;
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
    await settle(h);
    expect(view.decisions.map((decision) => decision.by)).toEqual(['autopilot']);
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(0);
    expect(incidents(events)).toHaveLength(0);
  });

  it('starts the repair of a question only after the pause is lifted', async () => {
    const h = await start();
    h.script({
      'code@Login': [{ verdict: 'needs_human', questions: [{ text: 'How?' }] }, {}],
      'code@Second': [{ waitFor: h.gate('second') }],
      repair: [
        {
          toolCalls: [
            { name: 'swarm_repair_answer', arguments: { group: 'login', answer: 'like this' } },
          ],
        },
      ],
    });
    await configure(h, { enabled: false });
    for (const title of ['Login', 'Second']) {
      await h.call('queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        groups: [{ title, task: title }],
        title,
      });
    }
    await h.call('queue_settings', { repository: h.repo, parallel: 2 });
    await h.call('queue_start', { repository: h.repo });
    await until('the question', async () => {
      const runs = (await h.call('status', {})) as RunView[];
      return runs.some((view) => view.groups.some((group) => group.status === 'needs_human'));
    });
    const runs = (await h.call('status', {})) as RunView[];
    const asked = runs.find((view) => view.groups.some((group) => group.status === 'needs_human'))!;
    await h.call('queue_settings', { repository: h.repo, parallel: 1 });
    await h.call('run_pause', { runId: asked.id });
    await h.call('observers_set', { settings: { enabled: true } });
    await settle(h);
    expect(h.running.application.services.runs.states.get(asked.id).run.hold).toBe('paused');
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(0);
    h.open('second');
    // Only a person lifts a pause: `queue_run_now` takes the paused run back.
    const queue = (await h.call('queue', { repository: h.repo })) as {
      items: { id: string; run: string | null }[];
    };
    const item = queue.items.find((candidate) => candidate.run === asked.id)!;
    await h.call('queue_run_now', { repository: h.repo, item: item.id });
    const view = await h.waitFor(asked.id, (run) => run.finished && run.state === 'finished');
    expect(view.decisions.map((decision) => decision.by)).toEqual(['observer']);
    expect(fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair')).toHaveLength(1);
  });
});

describe('Limits of observer actions', () => {
  it('refuses an unknown group and the repair group itself', async () => {
    const h = await start();
    h.script({
      code: [FAIL],
      repair: [
        {
          toolCalls: [
            { name: 'swarm_repair_retry', arguments: { group: 'unknown-group' } },
            { name: 'swarm_repair_retry', arguments: { group: '_repair' } },
            { name: 'swarm_repair_cancel', arguments: { group: '_repair', reason: 'x' } },
          ],
        },
      ],
    });
    await configure(h, { maxRepairs: 1 });
    const runId = await launch(h);
    await h.waitFor(runId, (view) => view.repair?.repairs === 1 && view.finished);
    await settle(h);
    const results = toolResults(h);
    expect(results).toHaveLength(3);
    for (const result of results) expect(result.isError).toBe(true);
    expect((await h.status(runId)).groups[0]?.status).toBe('failed');
  });

  it('lets the observer restart a failed split group', async () => {
    const h = await start(
      CODE_ONLY_CONFIG.replace(
        '    feature:\n      steps:',
        '    feature:\n      split: { specialist: coder, max_groups: 3 }\n      steps:',
      ),
    );
    h.script({
      split: [FAIL, { split: [{ title: 'Login', task: 'login' }] }],
      repair: [retry('_split')],
    });
    await configure(h);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'login',
    })) as RunCreated;
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
    expect(view.repair?.repairs).toBe(1);
    expect(toolResults(h)[0]?.isError).toBeUndefined();
  });

  it('refuses a call with an unknown token and a call from an ordinary group', async () => {
    const h = await start();
    h.script({ code: [{ waitFor: h.gate('code') }, {}] });
    const runId = await launch(h);
    await until('the agent', () =>
      fakeLines(h, 'calls.jsonl').some((call) => call.step === 'code'),
    );
    await expect(
      h.call('repair_action', { token: 'unknown-token', action: 'cancel', reason: 'x' }),
    ).rejects.toThrow(/token/);
    // the token of the running ordinary group, taken from the executor
    const tokens = (h.running.application.services.runs.effects as any).running.tokens as Map<
      string,
      { group: string }
    >;
    const token = [...tokens].find(([, key]) => key.group !== '_repair')?.[0];
    expect(token).toBeDefined();
    await expect(
      h.call('repair_action', { token: token!, action: 'cancel', reason: 'x' }),
    ).rejects.toThrow(/token/);
    await settle(h);
    expect((await h.status(runId)).groups[0]?.status).toBe('running');
    h.open('code');
    await h.waitFor(runId, (view) => view.finished);
  });

  it('refuses to restart a group a person cancelled', async () => {
    const h = await start();
    h.script({
      'code@Login': [{ waitFor: h.gate('code') }],
      'code@Second': [FAIL, {}],
      repair: [
        {
          waitFor: h.gate('repair'),
          toolCalls: [
            { name: 'swarm_repair_retry', arguments: { group: 'login' } },
            { name: 'swarm_repair_retry', arguments: { group: 'second' } },
          ],
        },
      ],
    });
    await configure(h);
    const runId = await launch(h, [
      { title: 'Login', task: 'login' },
      { title: 'Second', task: 'second' },
    ]);
    await h.waitFor(
      runId,
      (view) =>
        view.groups.some((group) => group.slug === 'login' && group.status === 'running') &&
        view.groups.some((group) => group.slug === 'second' && group.status === 'failed'),
    );
    await h.call('cancel', { runId, group: 'login' });
    await h.waitFor(runId, (run) =>
      run.groups.some((group) => group.slug === 'login' && group.status === 'cancelled'),
    );
    h.open('repair');
    const view = await h.waitFor(runId, (run) => run.finished && run.state !== 'repair');
    await until('both calls', () => toolResults(h).length === 2);
    const [first, second] = toolResults(h);
    expect(first?.isError).toBe(true);
    expect(JSON.stringify(first)).toContain('was cancelled');
    expect(second?.isError).toBeUndefined();
    expect(view.groups.find((group) => group.slug === 'login')?.status).toBe('cancelled');
  });

  it('refuses to answer a question for a person only', async () => {
    const h = await start();
    const question = { verdict: 'needs_human', humanOnly: true, questions: [{ text: 'Tell me' }] };
    h.script({
      'code@Login': [FAIL, {}],
      'code@Quiet': [question],
      repair: [
        {
          toolCalls: [{ name: 'swarm_repair_answer', arguments: { group: 'quiet', answer: 'no' } }],
        },
      ],
    });
    await configure(h, { maxRepairs: 1 });
    const runId = await launch(h, [
      { title: 'Login', task: 'login' },
      { title: 'Quiet', task: 'quietly' },
    ]);
    await h.waitFor(runId, (view) => view.repair?.repairs === 1 && view.repair.incident === null);
    const [result] = toolResults(h);
    expect(result?.isError).toBe(true);
    expect((await h.status(runId)).groups.find((group) => group.slug === 'quiet')?.status).toBe(
      'needs_human',
    );
  });
});

const REVIEW_CONFIG = PIPELINE_CONFIG.replace(
  'specialist: reviewer,',
  'specialist: reviewer, human_review: true,',
);

const ASKING = { verdict: 'needs_human', humanOnly: true, questions: [{ text: 'Tell me' }] };
const TWO = [
  { title: 'Login', task: 'login' },
  { title: 'Quiet', task: 'quietly' },
];

/** Starts a task whose group `quiet` waits for a person while `login` fails and is repaired. */
async function askingRun(h: Harness, calls: unknown[]): Promise<string> {
  h.script({
    'code@Login': [FAIL, {}],
    'code@Quiet': [ASKING],
    repair: [{ toolCalls: calls }],
  });
  await configure(h, { maxRepairs: 1 });
  const runId = await launch(h, TWO);
  await h.waitFor(runId, (view) => view.repair?.repairs === 1 && view.repair.incident === null);
  return runId;
}

describe('Human-only question', () => {
  it('refuses to cancel the group that waits for a person', async () => {
    const h = await start();
    const runId = await askingRun(h, [
      { name: 'swarm_repair_cancel', arguments: { group: 'quiet', reason: 'fed up' } },
    ]);
    const [result] = toolResults(h);
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('waits for a person');
    expect((await h.status(runId)).groups.find((group) => group.slug === 'quiet')?.status).toBe(
      'needs_human',
    );
  });

  it('refuses to cancel the task while such a question is open', async () => {
    const h = await start();
    const runId = await askingRun(h, [
      { name: 'swarm_repair_cancel', arguments: { reason: 'dead end' } },
    ]);
    const [result] = toolResults(h);
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('quiet');
    const view = await h.status(runId);
    expect(view.repair?.cancelReason ?? null).toBeNull();
    expect(view.groups.find((group) => group.slug === 'quiet')?.status).toBe('needs_human');
  });

  it('still cancels a task without such a question', async () => {
    const h = await start();
    h.script({
      code: [FAIL],
      repair: [{ toolCalls: [{ name: 'swarm_repair_cancel', arguments: { reason: 'dead end' } }] }],
    });
    await configure(h);
    const runId = await launch(h);
    const view = await h.waitFor(runId, (run) => run.repair?.cancelReason === 'dead end');
    expect(view.repair?.cancelReason).toBe('dead end');
    expect(toolResults(h)[0]?.isError).toBeUndefined();
  });

  it('refuses to answer a human review of a step', async () => {
    const h = await start(REVIEW_CONFIG);
    h.script({
      'code@Login': [FAIL, {}],
      review: [{ summary: 'check' }],
      repair: [
        {
          waitFor: h.gate('repair'),
          toolCalls: [
            { name: 'swarm_repair_answer', arguments: { group: 'quiet', answer: 'Accepted' } },
          ],
        },
      ],
    });
    await configure(h, { maxRepairs: 1 });
    const runId = await launch(h, TWO);
    await h.waitFor(runId, (view) =>
      view.groups.some((group) => group.slug === 'quiet' && group.status === 'needs_human'),
    );
    h.open('repair');
    await h.waitFor(runId, (view) => view.repair?.repairs === 1 && view.repair.incident === null);
    const [result] = toolResults(h);
    expect(result?.isError).toBe(true);
    const row = (await h.status(runId)).groups.find((group) => group.slug === 'quiet');
    expect(row).toMatchObject({ status: 'needs_human', humanOnly: 'review' });
  });
});

describe('Observer settings', () => {
  it('keeps the settings across a restart', async () => {
    const h = await start();
    const saved = await configure(h, { workers: 2 });
    expect(saved).toMatchObject({
      ok: true,
      view: { settings: { enabled: true, workers: 2 } },
    });
    await h.restart();
    const view = (await h.call('observers', {})) as ObserversView;
    expect(view.settings).toMatchObject({ enabled: true, workers: 2 });
  });

  it('rejects wrong values with the path of the field and keeps the old settings', async () => {
    const h = await start();
    await configure(h, { workers: 2 });
    const bad = (await h.call('observers_set', { settings: { workers: 0 } })) as Result;
    expect(bad).toMatchObject({ ok: false, errors: [{ path: 'workers' }] });
    const many = (await h.call('observers_set', {
      settings: {
        maxRepairs: 51,
        projects: [{ repository: '/nowhere', maxWorkers: 0 }],
        specialist: { timeout: 'soon' },
      },
    })) as { ok: false; errors: { path: string }[] };
    expect(many.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(['maxRepairs', 'projects[0].repository', 'projects[0].maxWorkers']),
    );
    expect(many.errors.some((error) => error.path.startsWith('specialist'))).toBe(true);
    const view = (await h.call('observers', {})) as ObserversView;
    expect(view.settings).toMatchObject({ enabled: true, workers: 2, maxRepairs: 5 });
  });

  it('rejects the removed answerHumanOnly key', async () => {
    const h = await start();
    const bad = (await h.call('observers_set', {
      settings: { answerHumanOnly: true },
    })) as { ok: false; errors: { path: string }[] };
    expect(bad).toMatchObject({ ok: false, errors: [{ path: 'answerHumanOnly' }] });
  });

  it('drops answerHumanOnly saved by an older version', async () => {
    const h = await start();
    await configure(h, { workers: 2 });
    h.running.application.database
      .prepare('UPDATE observers SET settings_json = ? WHERE id = 1')
      .run(JSON.stringify({ enabled: true, workers: 2, answerHumanOnly: true }));
    await h.restart();
    const view = (await h.call('observers', {})) as ObserversView;
    expect(view.settings).toMatchObject({ enabled: true, workers: 2 });
    expect(view.settings).not.toHaveProperty('answerHumanOnly');
  });

  it('drops a repository from the projects when it leaves the registry', async () => {
    const h = await start();
    await configure(h);
    await h.call('repository_remove', { path: h.repo });
    const view = (await h.call('observers', {})) as ObserversView;
    expect(view.settings.projects).toEqual([]);
  });

  it('tells subscribers about new settings and sends the runs again', async () => {
    const h = await start();
    h.script({ code: [FAIL], repair: [{ waitFor: h.gate('repair') }] });
    await configure(h, { enabled: false });
    const failedRun = await launch(h, [{ title: 'Second', task: 'second' }]);
    await h.waitFor(failedRun, (view) => view.groups[0]?.status === 'failed');
    const events = listen(h);
    await h.call('observers_set', { settings: { enabled: true } });
    await until('the observers event', () => events.some((event) => event.event === 'observers'));
    await until('the run again', () =>
      events.some(
        (event) =>
          event.event === 'run' &&
          event.run.id === failedRun &&
          (event.run as { state?: string }).state === 'repair',
      ),
    );
    h.open('repair');
  });

  it('takes the incident of a finished run kept in the store after enabling', async () => {
    const h = await start();
    h.script({ code: [FAIL, {}], repair: [retry()] });
    await configure(h, { enabled: false });
    const runId = await launch(h);
    await h.waitFor(runId, (view) => view.finished && view.state === 'failed');
    await settle(h);
    await h.restart();
    await h.call('observers_set', { settings: { enabled: true } });
    const view = await h.waitFor(runId, (run) => run.finished && run.state === 'finished');
    expect(view.repair?.repairs).toBe(1);
  });

  it('runs at most `workers` repairs, the oldest incident first', async () => {
    const h = await start();
    h.script({
      'code@Login': [FAIL, {}],
      'code@Second': [FAIL, {}],
      repair: [{ waitFor: h.gate('repair'), ...retry() }, retry('second')],
    });
    await configure(h, { workers: 1 });
    const first = await launch(h);
    await h.waitFor(first, (view) => view.repair?.incident !== null);
    const second = await launch(h, [{ title: 'Second', task: 'second' }]);
    await h.waitFor(second, (view) => view.groups[0]?.status === 'failed');
    await settle(h);
    expect((await h.status(second)).repair).toMatchObject({ incident: null, repairs: 0 });
    h.open('repair');
    await h.waitFor(first, (view) => view.finished && view.state === 'finished');
    await h.waitFor(second, (view) => view.finished && view.state === 'finished');
    const order = fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair');
    expect(order).toHaveLength(2);
    expect(String(order[0]?.cwd)).toContain(first);
    expect(String(order[1]?.cwd)).toContain(second);
  });
});

describe('Enabling only in the settings', () => {
  it('lets a running repair end, and starts no new one after switching off', async () => {
    const h = await start();
    h.script({
      'code@Login': [FAIL, {}],
      'code@Second': [FAIL, {}],
      repair: [{ waitFor: h.gate('repair'), ...retry() }],
    });
    await configure(h);
    const first = await launch(h);
    await h.waitFor(first, (view) => view.repair?.incident !== null);
    await h.call('observers_set', { settings: { enabled: false } });
    const second = await launch(h, [{ title: 'Second', task: 'second' }]);
    await h.waitFor(second, (view) => view.groups[0]?.status === 'failed');
    await settle(h);
    expect((await h.status(second)).repair).toMatchObject({ incident: null, repairs: 0 });
    h.open('repair');
    await h.waitFor(first, (view) => view.finished && view.state === 'finished');
    expect((await h.status(second)).state).toBe('failed');
  });

  it('does not change the settings through run_observer', async () => {
    const h = await start();
    h.script({ code: [FAIL] });
    await configure(h);
    const runId = await launch(h);
    await h.waitFor(runId, (view) => view.finished);
    const before = (await h.call('observers', {})) as ObserversView;
    await h.call('run_observer', { runId, enabled: false });
    const after = (await h.call('observers', {})) as ObserversView;
    expect(after.settings).toEqual(before.settings);
  });
});

describe('Delivery resolution by the observer', () => {
  const repairCalls = (h: Harness) =>
    fakeLines(h, 'calls.jsonl').filter((call) => call.step === 'repair');

  async function conflicting(
    h: Harness,
    repair: unknown[],
    settings: Record<string, unknown> = {},
  ): Promise<string> {
    h.script({
      code: [{ waitFor: h.gate('code'), write: { 'lib.ts': 'export const value = 2;\n' } }],
      repair,
    });
    await configure(h, settings);
    const runId = await launch(h);
    writeFileSync(join(h.repo, 'lib.ts'), 'export const value = 9;\n');
    h.open('code');
    return runId;
  }

  it('lets the observer settle a delivery conflict and delivers without force', async () => {
    const h = await start(`${CODE_ONLY_CONFIG}  delivery: { auto: true }\n`);
    const runId = await conflicting(h, [
      { read: ['lib.ts'], write: { 'lib.ts': 'export const value = 7;\n' } },
    ]);
    const view = await h.waitFor(
      runId,
      (run) => run.finished && run.delivery.applied === 1 && run.repair?.incident === null,
      30_000,
    );
    expect(view.delivery).toMatchObject({ applied: 1, failed: 0 });
    const [read] = fakeLines(h, 'reads.jsonl').filter((line) => line.step === 'repair');
    expect(read?.contents['lib.ts']).toContain('<<<<<<<');
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 7;\n');
  });

  it('leaves apply_failed and the user edits when markers remain', async () => {
    const h = await start(`${CODE_ONLY_CONFIG}  delivery: { auto: true }\n`);
    const runId = await conflicting(h, [{ summary: 'done' }]);
    await until('the observer', () => repairCalls(h).length >= 1);
    await h.waitFor(
      runId,
      (run) =>
        run.repair?.repairs === 1 && run.delivery.failed === 1 && run.repair.incident === null,
      30_000,
    );
    await settle(h);
    expect((await h.group(runId, 'login')).delivery).toMatchObject({ state: 'apply_failed' });
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 9;\n');
    // the same attempt is not taken again
    expect(repairCalls(h)).toHaveLength(1);
  });

  it('takes the delivery incident again after the pause when the observer crashes', async () => {
    const h = await startTimed(`${CODE_ONLY_CONFIG}  delivery: { auto: true }\n`);
    const runId = await conflicting(
      h,
      [FAIL, { read: ['lib.ts'], write: { 'lib.ts': 'export const value = 7;\n' } }],
      {},
    );
    await until('the crashed repair', () => repairCalls(h).length === 1);
    await h.waitFor(
      runId,
      (run) =>
        run.repair?.repairs === 0 && run.delivery.failed === 1 && run.repair.incident === null,
      30_000,
    );
    await settle(h);
    expect(repairCalls(h)).toHaveLength(1);
    expect(h.running.application.services.runs.engine.hasWakeTimer()).toBe(true);
    skewMs += REPAIR_PAUSE_MS + 60_000;
    await wake(h);
    const view = await h.waitFor(
      runId,
      (run) => run.finished && run.delivery.applied === 1 && run.repair?.incident === null,
      30_000,
    );
    expect(view.repair?.repairs).toBe(1);
    expect(repairCalls(h)).toHaveLength(2);
  });

  it('delivers without an agent when the conflict is gone by the time the observer starts', async () => {
    const h = await start(`${CODE_ONLY_CONFIG}  delivery: { auto: true }\n`);
    const runId = await conflicting(h, [], { enabled: false });
    await h.waitFor(runId, (run) => run.finished && run.delivery.failed === 1);
    writeFileSync(join(h.repo, 'lib.ts'), 'export const value = 1;\n');
    await h.call('observers_set', { settings: { enabled: true } });
    const view = await h.waitFor(
      runId,
      (run) =>
        run.delivery.applied === 1 && run.repair?.repairs === 1 && run.repair.incident === null,
      30_000,
    );
    expect(view.delivery).toMatchObject({ applied: 1, failed: 0 });
    expect(repairCalls(h)).toHaveLength(0);
  });
});
