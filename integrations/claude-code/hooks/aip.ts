import { atom, read, update } from 'claude-code';
import type { EngineInterface, Timer } from 'claude-code';

import type { AipConnection, AipEvent } from '../types';
import type { PaneModel } from './view.tsx';

import {
  applyArgv,
  applyEvent,
  describeApply,
  errorText,
  missingMessage,
  newNotices,
  parseApplyResult,
  parseEvent,
  parseRuns,
  resolveAnswers,
  missingAnswers,
  answerText,
  draftKey,
  runGroups,
  splitLines,
  statusSummary,
} from './feed.ts';

export const POLL_INTERVAL_MS = 2000;
export const RECONNECT_DELAY_MS = 5000;

const runsAtom = atom({ plugin: 'aip', key: 'runs' } as const, [], { shape: 'runs-1' });
const loadedAtom = atom({ plugin: 'aip', key: 'isLoaded' } as const, false);
const selectedAtom = atom({ plugin: 'aip', key: 'selectedRun' } as const, null);
const connectionAtom = atom(
  { plugin: 'aip', key: 'connection' } as const,
  { mode: 'connecting', error: null },
  { shape: 'connection-1' },
);
const notifiedAtom = atom({ plugin: 'aip', key: 'notified' } as const, [], {
  shape: 'notified-1',
});
const draftsAtom = atom({ plugin: 'aip', key: 'drafts' } as const, {}, { shape: 'drafts-1' });
const actionAtom = atom({ plugin: 'aip', key: 'actionResult' } as const, null, {
  shape: 'action-2',
});
const pendingAtom = atom({ plugin: 'aip', key: 'pending' } as const, [], { shape: 'pending-1' });

export type AipOutcome =
  { ok: true; stdout: string } | { ok: false; error: string; isMissing: boolean; stdout: string };

export function background(work: Promise<unknown>): void {
  work.catch(() => undefined);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runAip(
  $: EngineInterface,
  argv: readonly string[],
  args: readonly string[],
  cwd?: string,
): Promise<AipOutcome> {
  try {
    const result = await $.process.run([...argv, ...args], {
      timeoutMs: 120_000,
      ...(cwd ? { cwd } : {}),
    });
    if (result.exitCode === 0) return { ok: true, stdout: result.stdout };
    return {
      ok: false,
      error: errorText(result.stdout, result.stderr, result.exitCode),
      isMissing: false,
      stdout: result.stdout,
    };
  } catch (error) {
    return {
      ok: false,
      error: missingMessage(argv, messageOf(error)),
      isMissing: true,
      stdout: '',
    };
  }
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const runs = await read($, runsAtom);
  const connection = await read($, connectionAtom);
  $.ui.status(statusSummary(runs, connection));
}

async function setConnection($: EngineInterface, connection: AipConnection): Promise<void> {
  await update($, connectionAtom, () => connection);
  await refreshStatus($);
}

export function createFeed($: EngineInterface, argv: readonly string[]) {
  let queue: Promise<unknown> = Promise.resolve();
  let pollTimer: Timer | null = null;
  let reconnectTimer: Timer | null = null;
  let isStreaming = false;
  let isConnecting = false;
  let isStopped = false;

  function serial(work: () => Promise<void>): Promise<void> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  function receive(event: AipEvent): Promise<void> {
    return serial(async () => {
      const runs = applyEvent(await read($, runsAtom), event);
      const isFirstLoad = !(await read($, loadedAtom));
      const { notices, notified } = newNotices(runs, await read($, notifiedAtom), isFirstLoad);
      await update($, runsAtom, () => runs);
      await update($, notifiedAtom, () => notified);
      if (isFirstLoad) await update($, loadedAtom, () => true);
      for (const notice of notices) $.ui.toast(notice.text, { timeoutMs: 8000 });
      await refreshStatus($);
    });
  }

  function stopPolling(): void {
    pollTimer?.cancel();
    pollTimer = null;
  }

  async function poll(): Promise<void> {
    if (isStreaming || isStopped) return;
    const outcome = await runAip($, argv, ['run', 'list', '--json']);
    if (isStreaming || isStopped) return;
    if (!outcome.ok) {
      await setConnection($, {
        mode: outcome.isMissing ? 'missing' : 'polling',
        error: outcome.error,
      });
      return;
    }
    const runs = parseRuns(outcome.stdout);
    if (!runs) {
      await setConnection($, { mode: 'polling', error: 'aip run list printed no list of runs' });
      return;
    }
    await setConnection($, { mode: 'polling', error: null });
    await receive({ event: 'snapshot', seq: 0, runs });
  }

  function startPolling(): void {
    if (pollTimer || isStopped) return;
    pollTimer = $.clock.every(POLL_INTERVAL_MS, () => background(poll()));
  }

  function scheduleReconnect(): void {
    if (reconnectTimer || isStopped) return;
    reconnectTimer = $.clock.after(RECONNECT_DELAY_MS, () => {
      reconnectTimer = null;
      background(connect());
    });
  }

  async function connect(): Promise<void> {
    if (isConnecting || isStopped) return;
    isConnecting = true;
    let pending = '';
    let stderr = '';
    let isMissing = false;
    let lost = 'the event stream ended';
    try {
      const stream = $.process.spawn({ argv: [...argv, 'events', '--json'] });
      for await (const chunk of stream) {
        if (chunk.stream === 'stderr') {
          stderr += chunk.text;
          continue;
        }
        const { lines, rest } = splitLines(pending, chunk.text);
        pending = rest;
        for (const line of lines) {
          const event = parseEvent(line);
          if (!event) continue;
          if (event.event === 'snapshot' && !isStreaming) {
            isStreaming = true;
            stopPolling();
            await setConnection($, { mode: 'stream', error: null });
          }
          await receive(event);
        }
      }
      if (stderr.trim()) lost = errorText('', stderr, 1);
    } catch (error) {
      isMissing = !isStreaming;
      lost = isMissing ? missingMessage(argv, messageOf(error)) : messageOf(error);
    }
    isStreaming = false;
    isConnecting = false;
    if (isStopped) return;
    if (isMissing) {
      stopPolling();
      await setConnection($, { mode: 'missing', error: lost });
    } else {
      await setConnection($, { mode: 'polling', error: lost });
      startPolling();
    }
    scheduleReconnect();
  }

  return {
    start(): void {
      background(connect());
    },
    stop(): void {
      isStopped = true;
      stopPolling();
      reconnectTimer?.cancel();
      reconnectTimer = null;
    },
  };
}

export type Feed = ReturnType<typeof createFeed>;

export const RESULT_MS = 8000;

// Presses can arrive faster than an atom is written, so the guard is synchronous.
const inFlight = new Set<string>();
let lastResultId = 0;

type Shown = { text: string; isError: boolean };

async function showResult($: EngineInterface, result: Shown): Promise<void> {
  lastResultId += 1;
  const id = lastResultId;
  await update($, actionAtom, () => ({ id, ...result }));
  if (!result.isError)
    $.clock.after(RESULT_MS, () =>
      background(update($, actionAtom, (current) => (current?.id === id ? null : current))),
    );
}

export function createActions($: EngineInterface, argv: readonly string[]) {
  async function guarded(key: string, work: () => Promise<void>): Promise<void> {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    await update($, pendingAtom, (list) => [...list, key]);
    try {
      await work();
    } finally {
      inFlight.delete(key);
      await update($, pendingAtom, (list) => list.filter((one) => one !== key));
    }
  }

  async function perform(args: string[], done: string): Promise<boolean> {
    const outcome = await runAip($, argv, args);
    await showResult(
      $,
      outcome.ok ? { text: done, isError: false } : { text: outcome.error, isError: true },
    );
    return outcome.ok;
  }

  const target = (runId: string, group?: string) => (group ? `${runId}/${group}` : runId);

  return {
    async select(runId: string): Promise<void> {
      await update($, selectedAtom, () => runId);
    },
    async draft(key: string, text: string): Promise<void> {
      await update($, draftsAtom, (drafts) => ({ ...drafts, [key]: text }));
    },
    answer(runId: string, group: string, typed?: string, question?: number): Promise<void> {
      return guarded(`answer:${target(runId, group)}`, async () => {
        const drafts = { ...(await read($, draftsAtom)) };
        const runs = await read($, runsAtom);
        const found = runs.find((run) => run.id === runId);
        const current = found ? runGroups(found).find((one) => one.slug === group) : undefined;
        const questions =
          current?.questions && current.questions.length > 0 ? current.questions : null;
        if (questions) {
          if (typed !== undefined && question !== undefined)
            drafts[draftKey(runId, group, question)] = typed;
          const answers = resolveAnswers(
            questions,
            (index) => drafts[draftKey(runId, group, index)],
          );
          const missing = missingAnswers(answers)[0];
          if (missing !== undefined) {
            await showResult($, {
              text: `${group}: answer question ${missing} first`,
              isError: true,
            });
            return;
          }
          if (
            await perform(
              ['group', 'answer', runId, group, answerText(questions, answers)],
              `${group}: answered`,
            )
          )
            await update($, draftsAtom, (all) =>
              Object.fromEntries(
                Object.entries(all).filter(([name]) => !name.startsWith(`${runId}/${group}/q`)),
              ),
            );
          return;
        }
        const key = draftKey(runId, group);
        const text = (typed ?? drafts[key] ?? '').trim();
        if (!text) {
          await showResult($, { text: `${group}: type an answer first`, isError: true });
          return;
        }
        if (await perform(['group', 'answer', runId, group, text], `${group}: answered`))
          await update($, draftsAtom, (all) => {
            const rest = { ...all };
            delete rest[key];
            return rest;
          });
      });
    },
    retry(runId: string, group: string): Promise<void> {
      return guarded(`retry:${target(runId, group)}`, async () => {
        await perform(['group', 'retry', runId, group], `${group}: retried`);
      });
    },
    cancel(runId: string, group?: string): Promise<void> {
      return guarded(`cancel:${target(runId, group)}`, async () => {
        await perform(
          group ? ['group', 'cancel', runId, group] : ['run', 'cancel', runId],
          group ? `${group}: cancelled` : `run ${runId}: cancelled`,
        );
      });
    },
    apply(runId: string, group?: string): Promise<void> {
      return guarded(`apply:${target(runId, group)}`, async () => {
        const outcome = await runAip(
          $,
          argv,
          applyArgv({ runId, groups: group ? [group] : [], force: false }, true),
        );
        const result = parseApplyResult(outcome.stdout);
        if (result) {
          const described = describeApply(result);
          await showResult($, { text: described.plain, isError: described.isError });
        } else if (!outcome.ok) await showResult($, { text: outcome.error, isError: true });
        else await showResult($, { text: outcome.stdout.trim(), isError: false });
      });
    },
  };
}

export async function readPaneModel(
  $: EngineInterface,
  layout: { compact: boolean },
): Promise<PaneModel> {
  return {
    compact: layout.compact,
    now: await $.clock.now(),
    pending: await read($, pendingAtom),
    runs: await read($, runsAtom),
    selected: await read($, selectedAtom),
    connection: await read($, connectionAtom),
    drafts: await read($, draftsAtom),
    action: await read($, actionAtom),
  };
}
