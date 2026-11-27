import { afterEach, expect, it, vi } from 'vitest';
import { verifyDiagramWorker } from '../src/shared/api/diagrams/workerPolicy.ts';

afterEach(() => vi.restoreAllMocks());

const policy =
  "default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'";

it('checks and caches the worker isolation policy before a task can be posted', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('bundled worker', {
      headers: { 'content-security-policy': policy },
    }),
  );
  await Promise.all([
    verifyDiagramWorker('/safe-worker.js'),
    verifyDiagramWorker('/safe-worker.js'),
  ]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith('/safe-worker.js', {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
});

it.each([
  '',
  policy.replace("connect-src 'none'", "connect-src 'self'"),
  policy.replace("script-src 'wasm-unsafe-eval'", "script-src 'self' 'wasm-unsafe-eval'"),
  policy.replace("worker-src 'none'", "worker-src 'self'"),
])('refuses missing or weaker CSP: %s', async (unsafe) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response('worker', {
        headers: { 'content-security-policy': unsafe },
      }),
  );
  await expect(verifyDiagramWorker(`/unsafe-${unsafe}.js`)).rejects.toThrow('isolation');
  expect(fetch).toHaveBeenCalledOnce();
});
