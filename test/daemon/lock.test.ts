import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AlreadyRunning, acquireLock } from '../../src/app/index.ts';

const server = join(import.meta.dirname, '..', '..', 'src', 'app', 'daemon.ts');

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
    // The winner keeps the lock until its stdin is closed, so the others always meet it held.
    const script = `
      import { acquireLock } from ${JSON.stringify(server)};
      try { acquireLock(${JSON.stringify(lock)}); console.log('won'); process.stdin.resume(); await new Promise((r) => process.stdin.on('end', r)); }
      catch (error) { console.log(error.name); }
    `;
    const children = Array.from({ length: 6 }, () =>
      spawn(process.execPath, ['--input-type=module', '-e', script], {
        stdio: ['pipe', 'pipe', 'inherit'],
      }),
    );
    const exited = children.map((child) => new Promise((resolve) => child.once('close', resolve)));
    const outcomes = await Promise.all(
      children.map(
        (child) =>
          new Promise<string>((resolve) => {
            child.stdout.once('data', (chunk: Buffer) => resolve(String(chunk).trim()));
          }),
      ),
    );
    for (const child of children) child.stdin.end();
    await Promise.all(exited);
    expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'AlreadyRunning')).toHaveLength(5);
  });
});
