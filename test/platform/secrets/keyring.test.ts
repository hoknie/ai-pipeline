import { describe, expect, it } from 'vitest';

import {
  KeychainStore,
  SecretServiceStore,
  secretFailure,
  spawnRunner,
  type CommandRunner,
} from '../../../src/platform/secrets/index.ts';
import { fakeTool } from './fake-tools.ts';

const SENTINEL = 'sentinel-secret-5f1c9e "quoted" \n new line ü';

describe.each([
  ['Keychain', 'security', (file: string) => new KeychainStore(spawnRunner(), file)],
  ['Secret Service', 'secret-tool', (file: string) => new SecretServiceStore(spawnRunner(), file)],
] as const)('%s backend', (_name, kind, make) => {
  it('stores, reads and deletes a value by key, whatever characters it holds', async () => {
    const tool = fakeTool(kind);
    const store = make(tool.file);
    await store.check();
    expect(await store.get('aip/i/c1/token/g1')).toBeNull();
    await store.put('aip/i/c1/token/g1', SENTINEL);
    expect(await store.get('aip/i/c1/token/g1')).toBe(SENTINEL);
    await store.put('aip/i/c1/token/g1', 'second');
    expect(await store.get('aip/i/c1/token/g1')).toBe('second');
    await store.delete('aip/i/c1/token/g1');
    expect(await store.get('aip/i/c1/token/g1')).toBeNull();
    // Deleting what is not there is not a failure.
    await store.delete('aip/i/c1/token/g1');
  });

  it('never puts the value in the arguments of a process', async () => {
    const tool = fakeTool(kind);
    const store = make(tool.file);
    await store.put('aip/i/c1/token/g1', SENTINEL);
    await store.get('aip/i/c1/token/g1');
    await store.delete('aip/i/c1/token/g1');
    const argv = JSON.stringify(tool.argv());
    const hex = Buffer.from(SENTINEL).toString('hex');
    expect(argv).not.toContain('sentinel-secret');
    expect(argv).not.toContain(hex);
    // It travels on stdin, encoded.
    expect(tool.stdin()).toContain(hex);
    expect(tool.stdin()).not.toContain('sentinel-secret');
  });

  it('fails with a fixed text when the keyring does not answer', async () => {
    const tool = fakeTool(kind);
    const store = make(tool.file);
    await store.put('k', 'v');
    tool.break();
    for (const call of [
      () => store.check(),
      () => store.get('k'),
      () => store.put('k', SENTINEL),
      () => store.delete('k'),
    ]) {
      const error = await call().catch((caught: Error) => caught);
      expect(error).toMatchObject({ code: 'secrets.command_failed' });
      expect((error as Error).message).toBe(secretFailure('command_failed').message);
      expect((error as Error).message).not.toContain('locked');
    }
  });

  it('fails when the tool is not installed', async () => {
    const store = make('/nonexistent/tool');
    await expect(store.check()).rejects.toMatchObject({ code: 'secrets.command_failed' });
  });

  it('fails when the runner times out', async () => {
    const hang: CommandRunner = () => Promise.reject(secretFailure('command_failed'));
    const store = kind === 'security' ? new KeychainStore(hang) : new SecretServiceStore(hang);
    await expect(store.put('k', 'v')).rejects.toMatchObject({ code: 'secrets.command_failed' });
  });
});
