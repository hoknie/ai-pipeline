import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSecretStore,
  installationId,
  type CommandRunner,
} from '../../../src/platform/secrets/index.ts';

function sandbox() {
  const state = mkdtempSync(join(tmpdir(), 'aip-secret-select-'));
  const keyFile = join(state, 'key');
  writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  return { state, keyFile };
}

const refusing: CommandRunner = () => Promise.resolve({ code: 1, stdout: '', stderr: 'no bus' });

describe('secret store selection', () => {
  it('uses the system keyring by default and refuses an unsupported system', async () => {
    const { state } = sandbox();
    const seen: string[] = [];
    const run: CommandRunner = (file) => {
      seen.push(file);
      return Promise.resolve({ code: file === 'security' ? 44 : 1, stdout: '', stderr: '' });
    };
    await createSecretStore({
      stateDirectory: state,
      environment: {},
      platform: 'darwin',
      run,
    }).check();
    await createSecretStore({
      stateDirectory: state,
      environment: {},
      platform: 'linux',
      run,
    }).check();
    expect(seen).toEqual(['security', 'secret-tool']);
    await expect(
      createSecretStore({ stateDirectory: state, environment: {}, platform: 'win32', run }).check(),
    ).rejects.toMatchObject({ code: 'secrets.no_backend' });
    await expect(
      createSecretStore({
        stateDirectory: state,
        environment: { AIP_SECRETS_BACKEND: 'plaintext' },
        platform: 'linux',
        run,
      }).check(),
    ).rejects.toMatchObject({ code: 'secrets.no_backend' });
  });

  it('does not fall back to a file when the keyring fails', async () => {
    const { state } = sandbox();
    const store = createSecretStore({
      stateDirectory: state,
      environment: {},
      platform: 'linux',
      run: refusing,
    });
    await expect(store.put('k', 'secret-value')).rejects.toMatchObject({
      code: 'secrets.command_failed',
    });
    expect(existsSync(join(state, 'secrets', 'store.enc.json'))).toBe(false);
    expect(existsSync(join(state, 'secrets', 'backend.json'))).toBe(false);
  });

  it('selects the encrypted file explicitly and fails closed without its key', async () => {
    const { state, keyFile } = sandbox();
    const environment = { AIP_SECRETS_BACKEND: 'file' };
    const without = createSecretStore({ stateDirectory: state, environment, platform: 'linux' });
    await expect(without.put('k', 'secret-value')).rejects.toMatchObject({
      code: 'secrets.key_missing',
    });
    expect(existsSync(join(state, 'secrets', 'store.enc.json'))).toBe(false);
    const store = createSecretStore({
      stateDirectory: state,
      environment: { ...environment, AIP_SECRETS_KEY_FILE: keyFile },
      platform: 'linux',
    });
    await store.put('k', 'secret-value');
    expect(await store.get('k')).toBe('secret-value');
    expect(readFileSync(join(state, 'secrets', 'store.enc.json'), 'utf8')).not.toContain(
      'secret-value',
    );
  });

  it('keeps the backend chosen at the first write and refuses another one', async () => {
    const { state, keyFile } = sandbox();
    const file = createSecretStore({
      stateDirectory: state,
      environment: { AIP_SECRETS_BACKEND: 'file', AIP_SECRETS_KEY_FILE: keyFile },
      platform: 'linux',
    });
    await file.put('k', 'v');
    expect(JSON.parse(readFileSync(join(state, 'secrets', 'backend.json'), 'utf8'))).toEqual({
      backend: 'file',
    });
    const keyring = createSecretStore({
      stateDirectory: state,
      environment: {},
      platform: 'linux',
      run: refusing,
    });
    await expect(keyring.get('k')).rejects.toMatchObject({ code: 'secrets.backend_mismatch' });
    await expect(keyring.put('k', 'v')).rejects.toMatchObject({ code: 'secrets.backend_mismatch' });
    // The same selection afterwards works again.
    const again = createSecretStore({
      stateDirectory: state,
      environment: { AIP_SECRETS_BACKEND: 'file', AIP_SECRETS_KEY_FILE: keyFile },
      platform: 'linux',
    });
    expect(await again.get('k')).toBe('v');
  });

  it('gives the installation one id for good', () => {
    const { state } = sandbox();
    const id = installationId(state);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(installationId(state)).toBe(id);
    expect(statSync(join(state, 'secrets', 'installation')).mode & 0o077).toBe(0);
  });
});
