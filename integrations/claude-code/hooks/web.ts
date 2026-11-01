import type { EngineInterface } from 'claude-code';

import { errorText, missingMessage, parseWebUrl, splitLines, webArgv } from './feed.ts';

export const WEB_START_TIMEOUT_MS = 30_000;

/** `daemon`: the panel belongs to the aip daemon and stays up while the daemon runs. */
export type StopResult = 'stopped' | 'daemon' | 'none';

export type WebResult = { ok: true; url: string } | { ok: false; error: string };

type Outcome = { kind: 'url'; url: string } | { kind: 'failed'; error: string };

type Session = {
  iterator: AsyncIterator<unknown>;
  port: number | null;
  url: string | null;
  isStopping: boolean;
  /** `aip web` printed that the daemon serves the panel and exited: there is no process to stop. */
  byDaemon: boolean;
  done: Promise<void>;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exitCodeOf(result: unknown): number {
  if (typeof result === 'object' && result !== null && 'code' in result) {
    const code = (result as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return 1;
}

export function createWebServer($: EngineInterface, argv: readonly string[]) {
  let current: Session | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  async function kill(session: Session): Promise<void> {
    session.isStopping = true;
    // return() queues behind a pending next(), so it is not awaited: the
    // reader loop ends when the process does.
    void Promise.resolve(session.iterator.return?.()).catch(() => undefined);
    await session.done;
  }

  async function launch(port: number | null): Promise<WebResult> {
    const cwd = await $.session.cwd();
    const command = [...argv, ...webArgv(port)];
    let settle: (outcome: Outcome) => void = () => undefined;
    const outcome = new Promise<Outcome>((resolve) => {
      settle = resolve;
    });
    let session: Session;
    try {
      const stream = $.process.spawn({ argv: command, cwd });
      const iterator = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      session = {
        iterator,
        port,
        url: null,
        isStopping: false,
        byDaemon: false,
        done: Promise.resolve(),
      };
    } catch (error) {
      return { ok: false, error: missingMessage(argv, messageOf(error)) };
    }
    const started = session;

    started.done = (async () => {
      let pending = '';
      let stderr = '';
      let reason: string | null = null;
      let code = 1;
      try {
        while (true) {
          const step = await started.iterator.next();
          if (step.done) {
            code = exitCodeOf(step.value);
            break;
          }
          const chunk = step.value as { stream: string; text: string };
          if (chunk.stream === 'stderr') {
            stderr += chunk.text;
            continue;
          }
          const { lines, rest } = splitLines(pending, chunk.text);
          pending = rest;
          for (const line of lines) {
            if (/^aip web: served by the aip daemon\b/.test(line.trim())) started.byDaemon = true;
            const url = started.url === null ? parseWebUrl(line) : null;
            if (url === null) continue;
            started.url = url;
            settle({ kind: 'url', url });
          }
        }
      } catch (error) {
        reason = started.url === null ? missingMessage(argv, messageOf(error)) : messageOf(error);
      }
      if (started.url === null) {
        settle({ kind: 'failed', error: reason ?? errorText('', stderr, code) });
        return;
      }
      if (started.isStopping) return;
      if (started.byDaemon && code === 0 && reason === null) return;
      if (current === started) current = null;
      $.ui.toast(`aip web stopped: ${reason ?? errorText('', stderr, code)}`, {
        timeoutMs: 8000,
      });
    })();

    const timer = $.clock.after(WEB_START_TIMEOUT_MS, () =>
      settle({
        kind: 'failed',
        error: `aip web did not print a link in ${WEB_START_TIMEOUT_MS / 1000} s.`,
      }),
    );
    const result = await outcome;
    timer.cancel();
    if (result.kind === 'url') {
      current = started;
      return { ok: true, url: result.url };
    }
    await kill(started);
    return { ok: false, error: result.error };
  }

  async function begin(port: number | null): Promise<WebResult> {
    if (current?.url) return { ok: true, url: current.url };
    return launch(port);
  }

  async function end(): Promise<StopResult> {
    const session = current;
    if (!session) return 'none';
    current = null;
    await kill(session);
    return session.byDaemon ? 'daemon' : 'stopped';
  }

  return {
    start: (port: number | null): Promise<WebResult> => serial(() => begin(port)),
    stop: (): Promise<StopResult> => serial(end),
    restart: (port: number | null): Promise<WebResult> =>
      serial(async () => {
        const previous = current?.port ?? null;
        await end();
        return launch(port ?? previous);
      }),
    status: (): Promise<string | null> => serial(async () => current?.url ?? null),
  };
}

export type WebServer = ReturnType<typeof createWebServer>;
