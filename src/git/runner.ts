import { execFile } from 'node:child_process';

export interface GitCall {
  cwd: string;
  args: string[];
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitError extends Error {
  readonly args: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: string[], code: number, stderr: string) {
    super(`git ${args.join(' ')} failed (${code}): ${stderr.trim() || 'no output'}`);
    this.name = 'GitError';
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
let observer: ((call: GitCall) => void) | null = null;

export function observeGit(callback: ((call: GitCall) => void) | null): void {
  observer = callback;
}

export function runGit(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<GitResult> {
  observer?.({ cwd, args });
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        const result = { stdout: String(stdout), stderr: String(stderr), code };
        if (code !== 0 && !options.allowFailure)
          reject(new GitError(args, code, result.stderr || (error?.message ?? '')));
        else resolve(result);
      },
    );
  });
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await runGit(cwd, args)).stdout.trim();
}
