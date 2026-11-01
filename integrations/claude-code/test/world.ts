import type { On, ProcessRunResult, ProcessSpawnChunk } from 'claude-code';
import { mock } from 'claude-code/testing';

export const PANE = {
  plugin: 'aip',
  component: 'Pane',
  requestId: 'aip',
  props: {
    title: 'aip',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

export type FakeStream = {
  argv: readonly string[];
  write: (text: string) => void;
  writeErr: (text: string) => void;
  end: (code?: number) => void;
  killed: boolean;
  shape: string;
};

type Answer = Partial<ProcessRunResult> | { deny: string };

export function ok(stdout: string): Partial<ProcessRunResult> {
  return { exitCode: 0, stdout };
}

export function world(on: On, options: { missing?: boolean } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 });
  const statuses: (string | undefined)[] = [];
  const toasts: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const runs: (readonly string[])[] = [];
  const streams: FakeStream[] = [];
  const gates: { match: (argv: readonly string[]) => boolean; opened: Promise<void> }[] = [];
  const answers: ((argv: readonly string[]) => Answer | undefined)[] = [];

  on('ui.status', (_, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on('ui.toast', (_, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.open', (_, e) => {
    opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on('ui.close', (_, e) => {
    closed.push(e.id);
    return { value: undefined };
  });
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('session.cwd', () => ({ value: '/repo' }));
  on('process.run', async (_, e) => {
    runs.push(e.argv);
    for (const gate of gates) if (gate.match(e.argv)) await gate.opened;
    for (const answer of answers) {
      const found = answer(e.argv);
      if (!found) continue;
      if ('deny' in found) return { deny: found.deny };
      return {
        value: {
          exitCode: 0,
          stdout: '',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
          ...found,
        },
      };
    }
    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  // The engine ends a spawn by aborting a signal and waiting for the hook to
  // settle, so the wait for data is released by that signal.
  on('process.spawn', async function* (...args: unknown[]) {
    const e = args[1] as { argv: readonly string[] };
    const signals = findSignals(args);
    if (options.missing) return { deny: 'spawn aip ENOENT' } as never;
    type Piece = { stream: 'stdout' | 'stderr'; text: string } | { code: number };
    const pieces: Piece[] = [];
    let wake: (() => void) | null = null;
    let isExited = false;
    const push = (piece: Piece) => {
      pieces.push(piece);
      wake?.();
      wake = null;
    };
    const fake: FakeStream = {
      argv: e.argv,
      write: (text) => push({ stream: 'stdout', text }),
      writeErr: (text) => push({ stream: 'stderr', text }),
      end: (code = 1) => push({ code }),
      killed: false,
      shape: describe(args),
    };
    streams.push(fake);
    const isAborted = () => signals.some((signal) => signal.aborted);
    for (const signal of signals) {
      signal.addEventListener(
        'abort',
        () => {
          wake?.();
          wake = null;
        },
        { once: true },
      );
    }
    try {
      while (true) {
        while (pieces.length === 0) {
          if (isAborted()) return { value: { code: 143, signal: null } } as never;
          await new Promise<void>((resolve) => (wake = resolve));
        }
        const piece = pieces.shift();
        if (!piece) continue;
        if ('code' in piece) {
          isExited = true;
          return { value: { code: piece.code, signal: null } } as never;
        }
        const chunk: ProcessSpawnChunk = piece;
        yield chunk;
      }
    } finally {
      fake.killed = !isExited;
    }
  });

  return {
    clock,
    statuses,
    toasts,
    opened,
    closed,
    runs,
    streams,
    /** Holds the reply of matching commands until the returned function is called. */
    hold(match: (argv: readonly string[]) => boolean): () => void {
      let release: () => void = () => {};
      const opened = new Promise<void>((resolve) => {
        release = resolve;
      });
      gates.push({ match, opened });
      return release;
    },
    answer(match: (argv: readonly string[]) => Answer | undefined): void {
      answers.push(match);
    },
    async send(text: string): Promise<void> {
      lastStream().write(text);
      await clock.settle();
    },
    async close(): Promise<void> {
      lastStream().end();
      await clock.settle();
    },
    lastStream,
    streamOf(subcommand: string): FakeStream {
      const found = streams.findLast((stream) => stream.argv.includes(subcommand));
      if (!found) throw new Error(`no aip ${subcommand} process was started`);
      return found;
    },
  };

  function findSignals(root: unknown): AbortSignal[] {
    const found: AbortSignal[] = [];
    const seen = new Set<unknown>();
    const walk = (value: unknown, depth: number): void => {
      if (value instanceof AbortSignal) {
        if (!found.includes(value)) found.push(value);
        return;
      }
      if (depth > 3 || (typeof value !== 'object' && typeof value !== 'function')) return;
      if (value === null || seen.has(value)) return;
      seen.add(value);
      for (const key of Object.getOwnPropertyNames(value)) {
        try {
          walk((value as Record<string, unknown>)[key], depth + 1);
        } catch {
          // a getter that throws is not a signal
        }
      }
    };
    walk(root, 0);
    return found;
  }

  function describe(args: readonly unknown[]): string {
    return args
      .map((value, index) => {
        const keys =
          typeof value === 'object' || typeof value === 'function'
            ? Object.getOwnPropertyNames(value ?? {}).join(',')
            : '';
        return `arg${index}:${typeof value}[${keys}]`;
      })
      .join(' ');
  }

  function lastStream(): FakeStream {
    const stream = streams.at(-1);
    if (!stream) throw new Error('no aip events stream was started');
    return stream;
  }
}
