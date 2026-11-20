import { describe, expect, it } from 'vitest';

import type { CheckPort } from '../../../src/feature/integrations/ports/index.ts';
import { refusal } from '../../../src/feature/integrations/types/index.ts';

import { SENTINEL, exampleAdapter, fixture } from './helpers.ts';

async function enabled(
  check: CheckPort | undefined,
  overrides: Parameters<typeof fixture>[0] = {},
) {
  const f = fixture({
    adapters: [exampleAdapter(check === undefined ? {} : { check })],
    ...overrides,
  });
  const view = await f.services.connections.add({ kind: 'example', name: 'main', global: true });
  await f.services.connections.setSecret(view.id, 'token', SENTINEL);
  await f.services.connections.enable(view.id);
  return { f, id: view.id };
}

describe('check of a connection', () => {
  it('refuses a kind without a check before any call', async () => {
    const { f, id } = await enabled(undefined);
    await expect(f.services.checks.check(id)).rejects.toThrow(refusal('no_check').message);
  });

  it('refuses a disabled connection and one whose secret was removed, without a call', async () => {
    let calls = 0;
    const check: CheckPort = {
      check: () => {
        calls += 1;
        return Promise.resolve({ ok: true });
      },
    };
    const { f, id } = await enabled(check);
    f.services.connections.disable(id);
    await expect(f.services.checks.check(id)).rejects.toThrow(refusal('disabled').message);
    await f.services.connections.removeSecret(id, 'token');
    // removing the secret disables the connection first
    await expect(f.services.checks.check(id)).rejects.toThrow(refusal('disabled').message);
    await expect(f.services.checks.check('nope')).rejects.toThrow(refusal('not_found').message);
    expect(calls).toBe(0);
  });

  it('gives the adapter the parameters and the secret reader, and records the result', async () => {
    let seen: { token: string; params: unknown } | null = null;
    const { f, id } = await enabled({
      check: async (request) => {
        seen = { token: await request.secrets.read('token'), params: request.params };
        return { ok: true, count: 4 };
      },
    });
    const view = await f.services.checks.check(id);
    expect(seen).toEqual({ token: SENTINEL, params: {} });
    expect(view.lastCheck).toEqual({ at: 1000, ok: true, code: null, count: 4 });
    expect(JSON.stringify(view)).not.toContain(SENTINEL);
  });

  it('records a static code for a failure and never a text of the exception or of the adapter', async () => {
    const thrown = await enabled({ check: () => Promise.reject(new Error(`boom ${SENTINEL}`)) });
    const view = await thrown.f.services.checks.check(thrown.id);
    expect(view.lastCheck).toMatchObject({ ok: false, code: 'failed', count: null });
    const wild = await enabled({
      check: () => Promise.resolve({ ok: false, code: `Bad ${SENTINEL}`, count: 1.5 }),
    });
    const seen = await wild.f.services.checks.check(wild.id);
    expect(seen.lastCheck).toMatchObject({ ok: false, code: 'failed', count: null });
    expect(JSON.stringify(seen)).not.toContain(SENTINEL);
  });

  it('stops a check at the time limit with the timeout code', async () => {
    const { f, id } = await enabled(
      { check: () => new Promise(() => undefined) },
      { overrides: { checkTimeoutMs: 30 } },
    );
    expect((await f.services.checks.check(id)).lastCheck).toMatchObject({
      ok: false,
      code: 'timeout',
    });
  });

  it('keeps the result across a restart of the services', async () => {
    const { f, id } = await enabled({ check: () => Promise.resolve({ ok: true, count: 2 }) });
    await f.services.checks.check(id);
    const restarted = f.restart();
    const [view] = await restarted.connections.list();
    expect(view?.lastCheck).toEqual({ at: 1000, ok: true, code: null, count: 2 });
  });

  it('shows no check for a connection that was never checked', async () => {
    const { f } = await enabled({ check: () => Promise.resolve({ ok: true }) });
    expect((await f.services.connections.list())[0]?.lastCheck).toBeNull();
  });
});
