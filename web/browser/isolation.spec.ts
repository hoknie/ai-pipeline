import { expect, test } from '@playwright/test';

test('production Worker CSP blocks network, imports, nested workers and eval in a real browser', async ({
  page,
  request,
}) => {
  const attempted: string[] = [];
  const failed: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('private-diagram-marker')) attempted.push(request.url());
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('private-diagram-marker')) failed.push(request.url());
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const worker = new Worker(window.diagramFixture.probeUrl);
    try {
      return await new Promise<{ results: Record<string, string>; violations: string[] }>(
        (resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = () => reject(new Error('Probe worker failed'));
          worker.postMessage(`${location.origin}/private-diagram-marker`);
        },
      );
    } finally {
      worker.terminate();
    }
  });
  for (const name of [
    'fetch',
    'xhr',
    'websocket',
    'eventsource',
    'worker',
    'sharedworker',
    'importScripts',
    'import',
    'eval',
  ])
    expect(result.results[name], name).toBe('blocked');
  for (const name of ['document', 'beacon', 'webrtc'])
    expect(result.results[name], name).toBe('undefined');
  expect(result.violations).toEqual(
    expect.arrayContaining(['connect-src', 'script-src', 'worker-src']),
  );
  // Chromium reports request events even for loads cancelled by CSP before any socket I/O.
  expect(failed.sort()).toEqual(attempted.sort());
  expect(await (await request.get('/__canary-count')).json()).toBe(0);
});

for (const language of ['mermaid', 'plantuml'] as const) {
  test(`${language}: real engine retains inert DOM and immutable blocked APIs after rendering`, async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const created = page.waitForEvent('worker');
    const handle = await page.evaluateHandle(() => new Worker(window.diagramFixture.workerUrl));
    const worker = await created;
    try {
      const response = await handle.evaluate(
        (worker, language) =>
          new Promise<{ ok: boolean; svg: string }>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = () => reject(new Error('Engine failed'));
            worker.postMessage({
              language,
              source: language === 'mermaid' ? 'graph TD\nA-->B' : '@startuml\nA -> B\n@enduml',
            });
          }),
        language,
      );
      expect(response.ok).toBe(true);
      expect(response.svg).toContain('<svg');
      const blocked = await worker.evaluate(() => {
        const results: Record<string, boolean> = {};
        for (const name of [
          'fetch',
          'XMLHttpRequest',
          'WebSocket',
          'EventSource',
          'WebTransport',
          'RTCPeerConnection',
          'Worker',
          'SharedWorker',
          'importScripts',
        ]) {
          const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)!;
          try {
            Reflect.get(globalThis, name)('http://127.0.0.1:4178/private-diagram-marker');
            results[name] = false;
          } catch {
            results[name] = descriptor.writable === false && descriptor.configurable === false;
          }
        }
        results.documentIsInert = !('location' in document);
        results.windowIsInert = typeof window === 'undefined' || !('location' in window);
        results.noNavigation = !('assign' in location) && !('replace' in location);
        return results;
      });
      expect(Object.values(blocked).every(Boolean), JSON.stringify(blocked)).toBe(true);
      expect(await (await request.get('/__canary-count')).json()).toBe(0);
    } finally {
      await handle.evaluate((worker) => worker.terminate());
      await handle.dispose();
    }
  });

  test(`${language}: terminates a synchronously hung real Worker at the production timeout`, async ({
    page,
  }) => {
    await page.goto('/');
    const workerCreated = page.waitForEvent('worker');
    await page.evaluate((language) => window.diagramFixture.hang(language), language);
    const worker = await workerCreated;
    // Wait for the real engine bundle to initialize, then simulate a non-yielding engine loop.
    await worker.evaluate(async () => {
      while (typeof self.onmessage !== 'function')
        await new Promise((resolve) => setTimeout(resolve, 10));
      self.onmessage = () => {
        while (true) {
          /* interrupted only by Worker.terminate */
        }
      };
    });
    await page.evaluate(() => window.diagramFixture.release());
    await expect
      .poll(() => page.evaluate(() => window.diagramFixture.status))
      .toBe('Diagram rendering timed out');
    expect(await page.evaluate(() => window.diagramFixture.terminated)).toBe(1);
    await expect(page.getByRole('button', { name: 'Markdown source' })).toBeEnabled();
    await expect.poll(() => page.workers().length).toBe(0);
  });
}
