import type { ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { serveAsset } from '../../../src/presentation/web/pages.ts';

vi.mock('node:fs', () => ({ existsSync: () => true, readFileSync: () => 'bundled worker' }));

it('serves self-contained JS workers with their own no-network and no-script-import policy', () => {
  const writeHead = vi.fn();
  const end = vi.fn();
  serveAsset(
    { writeHead, end } as unknown as ServerResponse,
    '/panel',
    '/assets/diagram.worker-123.js',
  );
  expect(writeHead).toHaveBeenCalledWith(
    200,
    expect.objectContaining({
      'content-security-policy':
        "default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'",
      'x-content-type-options': 'nosniff',
    }),
  );
  expect(end).toHaveBeenCalledWith('bundled worker');
});
