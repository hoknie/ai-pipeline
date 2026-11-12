import { describe, expect, it } from 'vitest';

import { runCommand } from '../../src/platform/process/index.ts';

const options = { cwd: process.cwd(), env: {}, timeout: 10_000 };

describe('runCommand', () => {
  it('resolves with the stdout and passes the environment', async () => {
    const result = await runCommand(
      process.execPath,
      ['-e', 'console.log("a/b", process.env.AIP_TEST_VAR)'],
      { ...options, env: { AIP_TEST_VAR: 'x' } },
    );
    expect(result.stdout).toBe('a/b x\n');
  });

  it('rejects with the first line of stderr on a non-zero exit code', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'console.error("boom"); process.exit(3)'], options),
    ).rejects.toThrow('boom');
  });

  it('rejects with ENOENT for a missing executable', async () => {
    await expect(runCommand('/nonexistent/aip-binary', [], options)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects when the timeout runs out', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
        ...options,
        timeout: 100,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
