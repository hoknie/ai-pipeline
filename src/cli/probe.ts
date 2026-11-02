import { execFile } from 'node:child_process';

/** The first line of `<bin> --version`, or `unknown (<reason>)` when the binary does not answer. */
export function probeVersion(executable: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(executable, ['--version'], { timeout: 10_000 }, (error, stdout) => {
      resolve(
        error
          ? `unknown (${error.message.split('\n')[0]})`
          : (String(stdout).trim().split('\n')[0] ?? ''),
      );
    });
  });
}
