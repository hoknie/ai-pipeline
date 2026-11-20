#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';

import { usage, type CliIo } from '../presentation/cli/io.ts';
import { runCli } from '../presentation/cli/program.ts';
import { applyKeys } from '../presentation/cli/secret-keys.ts';

/** Stdin up to `limit` bytes; null when longer. On a terminal the keys are not echoed. */
async function readStdin(limit: number): Promise<string | null> {
  const stdin = process.stdin;
  if (stdin.isTTY) {
    process.stderr.write('Value (hidden, Enter to finish): ');
    stdin.setRawMode(true);
    stdin.resume();
    let text = '';
    try {
      for await (const chunk of stdin) {
        const outcome = applyKeys(text, String(chunk), limit);
        text = outcome.text;
        if (!outcome.done) continue;
        if (outcome.cancelled) throw usage('secret input cancelled');
        return outcome.tooLong ? null : text;
      }
    } finally {
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    }
    return text;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stdin) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      stdin.destroy();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const io: CliIo = {
  cwd: process.cwd(),
  env: process.env,
  isTTY: process.stdout.isTTY === true,
  columns: process.stdout.isTTY === true ? process.stdout.columns : undefined,
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
  readStdin,
  relay: () => ({ input: process.stdin, output: process.stdout }),
  setExitCode: (code) => {
    process.exitCode = code;
  },
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => void process.once(signal, handler),
};

await runCli(process.argv, io);
