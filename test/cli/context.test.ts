import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CliIo } from '../../src/presentation/cli/io.ts';
import { runCli } from '../../src/presentation/cli/program.ts';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'aip-context-')));
const main = join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');
const ANSI = '\x1b[';

interface Call {
  code: number;
  stdout: string;
  stderr: string;
  exited: number[];
}

/** Runs the CLI in the test process with its own `CliIo`; nothing of `process` is touched. */
async function call(args: string[], env: NodeJS.ProcessEnv = {}): Promise<Call> {
  const result: Call = { code: 0, stdout: '', stderr: '', exited: [] };
  const io: CliIo = {
    cwd: base,
    env: {
      XDG_STATE_HOME: join(base, 'state'),
      XDG_CONFIG_HOME: join(base, 'config'),
      ...env,
    },
    isTTY: false,
    entry: [process.execPath, main],
    pid: process.pid,
    stdout: (text) => void (result.stdout += text),
    stderr: (text) => void (result.stderr += text),
    setExitCode: (code) => {
      result.code = code;
    },
    exit: (code) => void result.exited.push(code),
    onSignal: () => undefined,
  };
  await runCli([process.execPath, main, ...args], io);
  return result;
}

describe('the context of a call', () => {
  it('writes the output of a command to the streams of the call', async () => {
    const json = await call(['version', '--json']);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toHaveProperty('version');
    const flag = await call(['--version']);
    expect(flag.code).toBe(0);
    expect(flag.stdout.trim()).toBe(JSON.parse(json.stdout).version);
  });

  it('keeps the style of one call from the next one when calls overlap', async () => {
    const [colored, plain] = await Promise.all([
      call(['run', '--help'], { FORCE_COLOR: '1' }),
      call(['run', '--help']),
    ]);
    expect(colored.stdout).toContain(ANSI);
    expect(plain.stdout).not.toContain(ANSI);
    expect(plain.stdout).toContain('Usage: aip run');
  });

  it('reports a wrong command with exit code 1 and leaves the process alone', async () => {
    const result = await call(['no-such-command']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown command');
    expect(result.exited).toEqual([]);
  });
});
