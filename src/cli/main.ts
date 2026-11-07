#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';

import type { CliIo } from '../presentation/cli/io.ts';
import { runCli } from '../presentation/cli/program.ts';

const io: CliIo = {
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
  entry: [process.execPath, process.argv[1] ?? ''],
  pid: process.pid,
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  ask: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } catch {
      return null;
    } finally {
      rl.close();
    }
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => void process.once(signal, handler),
};

await runCli(process.argv, io);
