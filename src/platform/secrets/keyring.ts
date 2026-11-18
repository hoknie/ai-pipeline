import { decodeValue, encodeValue, type CommandRunner } from './command.ts';
import { secretFailure } from './errors.ts';
import type { SecretStore } from './store.ts';

const SERVICE = 'aip-secrets';
const PROBE = 'aip/probe';

/**
 * The macOS Keychain through `security`. A value reaches it on stdin of `security -i` (hex encoded,
 * so no quoting is needed), never in argv, which any process of the machine can read.
 */
export class KeychainStore implements SecretStore {
  private readonly run: CommandRunner;
  private readonly file: string;

  constructor(run: CommandRunner, file = 'security') {
    this.run = run;
    this.file = file;
  }

  async check(): Promise<void> {
    await this.get(PROBE);
  }

  async get(key: string): Promise<string | null> {
    const result = await this.run(
      this.file,
      ['find-generic-password', '-a', key, '-s', SERVICE, '-w'],
      null,
    );
    if (result.code === 44) return null;
    if (result.code !== 0) throw secretFailure('command_failed');
    return decodeValue(result.stdout);
  }

  async put(key: string, value: string): Promise<void> {
    const command = `add-generic-password -U -a "${key}" -s "${SERVICE}" -w "${encodeValue(value)}"\n`;
    const result = await this.run(this.file, ['-i'], command);
    // `security -i` may exit 0 after a failed command: the stored value is read back to be sure.
    if (result.code !== 0 || (await this.get(key)) !== value) {
      throw secretFailure('command_failed');
    }
  }

  async delete(key: string): Promise<void> {
    const result = await this.run(
      this.file,
      ['delete-generic-password', '-a', key, '-s', SERVICE],
      null,
    );
    if (result.code !== 0 && result.code !== 44) throw secretFailure('command_failed');
  }
}

/** The Secret Service (GNOME Keyring, KWallet) through `secret-tool`, which reads a value from stdin. */
export class SecretServiceStore implements SecretStore {
  private readonly run: CommandRunner;
  private readonly file: string;

  constructor(run: CommandRunner, file = 'secret-tool') {
    this.run = run;
    this.file = file;
  }

  async check(): Promise<void> {
    await this.get(PROBE);
  }

  async get(key: string): Promise<string | null> {
    const result = await this.run(this.file, ['lookup', 'service', SERVICE, 'account', key], null);
    // No match: exit 1 and nothing on stderr; a missing session bus or a locked keyring says so.
    if (result.code === 1 && result.stderr.trim() === '' && result.stdout === '') return null;
    if (result.code !== 0) throw secretFailure('command_failed');
    return decodeValue(result.stdout);
  }

  async put(key: string, value: string): Promise<void> {
    const result = await this.run(
      this.file,
      ['store', '--label=aip secret', 'service', SERVICE, 'account', key],
      encodeValue(value),
    );
    if (result.code !== 0) throw secretFailure('command_failed');
  }

  async delete(key: string): Promise<void> {
    const result = await this.run(this.file, ['clear', 'service', SERVICE, 'account', key], null);
    if (result.code !== 0 && !(result.code === 1 && result.stderr.trim() === '')) {
      throw secretFailure('command_failed');
    }
  }
}
