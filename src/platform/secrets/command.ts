import { spawn } from 'node:child_process';

import { secretFailure } from './errors.ts';

export interface CommandResult {
  code: number;
  stdout: string;
  /** Only to tell "not found" from a failure; it is never shown or logged. */
  stderr: string;
}

/** Runs a tool with `input` on its stdin; the arguments never carry a secret. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  input: string | null,
) => Promise<CommandResult>;

/** Runs a system tool, feeding secrets through stdin only, with a time limit. */
export function spawnRunner(timeoutMs = 15_000): CommandRunner {
  return (file, args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(secretFailure('command_failed'));
      }, timeoutMs);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      child.stdin.on('error', () => undefined);
      child.once('error', () => {
        clearTimeout(timer);
        reject(secretFailure('command_failed'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      child.stdin.end(input ?? '');
    });
}

const encode = (value: string): string => Buffer.from(value, 'utf8').toString('hex');
const decode = (text: string): string => Buffer.from(text.trim(), 'hex').toString('utf8');
export { decode as decodeValue, encode as encodeValue };
