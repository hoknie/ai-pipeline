import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Usage } from '../../src/core/index.ts';
import { readLines, readTimes, timesPath } from '../../src/daemon/logs.ts';
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

describe('launchProcess timesPath', () => {
  const script = `
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    console.log('one');
    await wait(60);
    process.stderr.write('warn a\\nwarn b\\n');
    await wait(60);
    console.log('two');
  `;
  const launch = {
    command: globalThis.process.execPath,
    args: ['--input-type=module', '-e', script],
    env: {},
    files: [],
    sessionId: null,
  };

  it('writes the time of each log line next to the log and leaves the log as it is', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-supervisor-'));
    const logPath = join(directory, 'output.log');
    // a line an executor wrote before the start keeps the number 0
    writeFileSync(logPath, '[aip] warning: skill not found\n');
    const started = Date.now();
    const process = launchProcess(launch, {
      cwd: directory,
      logPath,
      parser: summing(),
      environment: globalThis.process.env,
      timesPath: timesPath(logPath),
    });
    await process.exited;
    const finished = Date.now();
    const lines = readLines(logPath, 0).lines;
    expect(lines.slice(0, 4)).toEqual([
      '[aip] warning: skill not found',
      'one',
      'warn a',
      'warn b',
    ]);
    expect(lines[4]).toBe('two');
    expect(lines.at(-1)).toMatch(/^\[aip\] exited/);
    const times = readTimes(timesPath(logPath));
    // the line written before the start has no time; every line of the process has one
    expect(times.has(0)).toBe(false);
    expect([...times.keys()]).toEqual(lines.map((_, index) => index).slice(1));
    const moments = [...times.values()];
    expect(moments).toEqual([...moments].sort((a, b) => a - b));
    expect(moments[0]).toBeGreaterThanOrEqual(started);
    expect(moments.at(-1)).toBeLessThanOrEqual(finished);
    // the second stderr line, two chunks apart from `one`, is later than `one`
    expect(times.get(2)! - times.get(1)!).toBeGreaterThanOrEqual(30);
  });

  it('writes no times file without the option', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-supervisor-'));
    const logPath = join(directory, 'output.log');
    await launchProcess(launch, {
      cwd: directory,
      logPath,
      parser: summing(),
      environment: globalThis.process.env,
    }).exited;
    expect(existsSync(timesPath(logPath))).toBe(false);
  });
});

describe('readTimes', () => {
  it('reads the lines of the file, skips broken ones and gives an empty map without a file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-times-'));
    const path = join(directory, 'output.times');
    expect(readTimes(path).size).toBe(0);
    writeFileSync(path, '0\t100\nbroken\n1\tabc\n2\t300\n2\t400\n\n3\t500');
    expect([...readTimes(path)]).toEqual([
      [0, 100],
      [2, 300],
      [3, 500],
    ]);
    expect(timesPath('/a/b/output.log')).toBe('/a/b/output.times');
  });
});
