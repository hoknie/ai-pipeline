import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A chunk above this size makes Vite warn; the budget is fixed here, not read from the build config.
const maxChunkBytes = 500_000;

let outDir = '';

describe('web bundle', () => {
  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'aip-web-bundle-'));
    // NODE_ENV=production: Vitest sets `test`, which would build development React.
    const result = spawnSync(
      resolve('node_modules/.bin/vite'),
      ['build', '--config', 'web/vite.config.ts', '--outDir', outDir, '--emptyOutDir'],
      { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } },
    );
    if (result.status !== 0) {
      throw new Error(`vite build failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
  }, 60_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('keeps every script chunk within the size budget', () => {
    const assets = join(outDir, 'assets');
    const files = readdirSync(assets).filter((name) => name.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    const oversized = files
      .map((name) => ({ name, size: statSync(join(assets, name)).size }))
      .filter((file) => file.size > maxChunkBytes)
      .map((file) => `${file.name}: ${file.size} bytes`);
    expect(oversized, `chunks larger than ${maxChunkBytes} bytes`).toEqual([]);
  });
});
