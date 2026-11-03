import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Usage } from '../../src/core/index.ts';
import { launchProcess } from '../../src/daemon/supervisor.ts';
import type { OutputParser } from '../../src/runtime/index.ts';

/** A parser whose usage is the sum of the numbers on the lines it was given. */
function summing(): OutputParser {
  let total: number | null = null;
  const usage = (): Usage | null =>
    total === null ? null : { inputTokens: total, outputTokens: 0, costUsd: null };
  return {
    push(line) {
      const value = Number(line);
      if (!Number.isNaN(value)) total = (total ?? 0) + value;
    },
    usage,
    outcome: () => ({ sessionId: null, usage: usage(), error: null, denials: [] }),
  };
}

describe('launchProcess onUsage', () => {
  it('reports each change of usage once and nothing for lines that change nothing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-supervisor-'));
    const seen: number[] = [];
    const process = launchProcess(
      {
        command: globalThis.process.execPath,
        args: ['-e', 'for (const l of ["noise", "5", "0", "noise", "7"]) console.log(l)'],
        env: {},
        files: [],
        sessionId: null,
      },
      {
        cwd: directory,
        logPath: join(directory, 'output.log'),
        parser: summing(),
        environment: globalThis.process.env,
        onUsage: (usage) => seen.push(usage.inputTokens),
      },
    );
    const exit = await process.exited;
    // `5`, then `0` adds nothing (same value), then `7`.
    expect(seen).toEqual([5, 12]);
    expect(exit.outcome.usage?.inputTokens).toBe(12);
  });
});
