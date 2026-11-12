import { execFile } from 'node:child_process';

const MAX_BUFFER = 8 * 1024 * 1024;

export interface CommandOptions {
  cwd: string;
  /** Added to the environment of this process. */
  env: Record<string, string>;
  /** Milliseconds. */
  timeout: number;
}

/** Runs a short command and resolves with its stdout; rejects on a failure, a timeout or ENOENT. */
export function runCommand(
  file: string,
  args: string[],
  options: CommandOptions,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        timeout: options.timeout,
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr)
            .split('\n')
            .find((line) => line.trim() !== '');
          reject(Object.assign(error, detail ? { message: detail.trim() } : {}));
        } else resolve({ stdout: String(stdout) });
      },
    );
  });
}
