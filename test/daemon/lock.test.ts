import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { AlreadyRunning, acquireLock } from '../../src/daemon/index.ts';

const run = promisify(execFile);
const server = join(import.meta.dirname, '..', '..', 'src', 'daemon', 'server.ts');

function directory(): string {
  return mkdtempSync(join(tmpdir(), 'aip-lock-'));
}

describe('daemon lock', () => {
  it('takes a free lock, keeps it for the same process and replaces a lock of a dead one', () => {
    const lock = join(directory(), 'aip.pid');
    acquireLock(lock);
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
    acquireLock(lock);
    writeFileSync(lock, '999999999');
    acquireLock(lock);
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));
  });

  it('refuses a lock held by a live process', () => {
    const lock = join(directory(), 'aip.pid');
    const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
    try {
      writeFileSync(lock, String(holder.pid));
      expect(() => acquireLock(lock)).toThrow(AlreadyRunning);
    } finally {
      holder.kill();
    }
  });

  it('lets only one of several processes started at once take the lock', async () => {
    const lock = join(directory(), 'aip.pid');
    const script = `
      import { acquireLock } from ${JSON.stringify(server)};
      try { acquireLock(${JSON.stringify(lock)}); console.log('won'); await new Promise((r) => setTimeout(r, 1500)); }
      catch (error) { console.log(error.name); }
    `;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => run(process.execPath, ['--input-type=module', '-e', script])),
    );
    const outcomes = results.map((result) => result.stdout.trim());
    expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'AlreadyRunning')).toHaveLength(5);
  });
});
