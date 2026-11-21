import { createHmac, timingSafeEqual } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { rejected } from '../../../src/platform/errors/index.ts';
import type {
  InboundVerifierPort,
  VerifiedToken,
  VerifyContext,
} from '../../../src/feature/integrations/ports/index.ts';
import type { InboundRequest } from '../../../src/feature/integrations/services/index.ts';
import { EXAMPLE, SENTINEL, exampleAdapter, fixture, type Fixture } from './helpers.ts';

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const sign = (secret: string, body: Uint8Array): string =>
  createHmac('sha256', secret).update(body).digest('hex');

/** A verifier of the tests: HMAC-SHA256 of the raw body with the `token` secret. */
function hmacVerifier(spy: { calls: number } = { calls: 0 }): InboundVerifierPort {
  return {
    async verify(context: VerifyContext): Promise<VerifiedToken | null> {
      spy.calls += 1;
      const secret = await context.secrets.read('token');
      const given = Buffer.from(context.headers['x-signature'] ?? '', 'hex');
      const wanted = Buffer.from(sign(secret, context.body), 'hex');
      if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
      // Only now the bytes are decoded.
      const payload = JSON.parse(new TextDecoder().decode(context.body)) as {
        id: string;
        operation: never;
        project?: string;
      };
      return context.accept({
        externalEventId: payload.id,
        operation: payload.operation,
        ...(payload.project === undefined ? {} : { project: payload.project }),
      });
    },
  };
}

const TASK = { type: 'queue_task', pipeline: 'feature', task: 'do it' } as const;

async function setup(f: Fixture, overrides: { global?: boolean; name?: string } = {}) {
  const { connections } = f.services;
  const created = await connections.add({
    kind: 'example',
    name: overrides.name ?? 'main',
    ...(overrides.global ? { global: true } : { repository: 'app' }),
  });
  await connections.setSecret(created.id, 'token', 'shared-secret');
  await connections.enable(created.id);
  return created.id;
}

function signed(connectionId: string, payload: unknown, secret = 'shared-secret'): InboundRequest {
  const body = encode(payload);
  return {
    verifier: 'example',
    connectionId,
    body,
    headers: { 'x-signature': sign(secret, body) },
  };
}

describe('inbound gate', () => {
  it('performs the operation of a verified event in the project of its connection', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier() })] });
    const id = await setup(f);
    const outcome = await f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    expect(outcome).toEqual({ status: 'applied', connectionId: id, result: { queued: true } });
    expect(f.performed).toEqual([{ project: '/work/app', operation: TASK }]);
  });

  it('refuses a wrong signature, without a claim and without the domain', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier() })] });
    const id = await setup(f);
    const error = await f.services.inbound
      .receive(signed(id, { id: 'e1', operation: TASK }, SENTINEL))
      .catch((caught: Error) => caught);
    expect(String((error as Error).message)).toMatch(/authentication failed/);
    expect(String((error as Error).message)).not.toContain('shared-secret');
    expect(f.performed).toEqual([]);
    expect(f.database.prepare('SELECT * FROM integration_deliveries').all()).toEqual([]);
  });

  it('refuses a body above the limit before the verifier sees it', async () => {
    const spy = { calls: 0 };
    const f = fixture({
      adapters: [exampleAdapter({ verifier: hmacVerifier(spy) })],
      overrides: { limits: { maxBodyBytes: 64 } },
    });
    const id = await setup(f);
    await expect(
      f.services.inbound.receive(
        signed(id, { id: 'e1', operation: TASK, padding: 'x'.repeat(200) }),
      ),
    ).rejects.toThrow(/too large/);
    expect(spy.calls).toBe(0);
  });

  it('does not take a self-made proof of authentication for one', async () => {
    const forging: InboundVerifierPort = {
      verify: () =>
        Promise.resolve({
          brand: 'verified',
          authenticatedAt: 1,
          connectionId: 'whatever',
        } as unknown as VerifiedToken),
    };
    const f = fixture({ adapters: [exampleAdapter({ verifier: forging })] });
    const id = await setup(f);
    await expect(
      f.services.inbound.receive({
        verifier: 'example',
        connectionId: id,
        body: new Uint8Array(),
        headers: {},
      }),
    ).rejects.toThrow(/authentication failed/);
    expect(f.performed).toEqual([]);
  });

  it('does not take the proof of one call for another, nor a proof used before', async () => {
    let kept: VerifiedToken | null = null;
    const replaying: InboundVerifierPort = {
      async verify(context) {
        if (kept !== null) return kept;
        kept = context.accept({ externalEventId: 'e1', operation: TASK });
        return kept;
      },
    };
    const f = fixture({ adapters: [exampleAdapter({ verifier: replaying })] });
    const id = await setup(f);
    const request = { verifier: 'example', connectionId: id, body: new Uint8Array(), headers: {} };
    await f.services.inbound.receive(request);
    await expect(f.services.inbound.receive(request)).rejects.toThrow(/authentication failed/);
    expect(f.performed).toHaveLength(1);
  });

  it('takes the connection, project and event id from the verifier, not from the payload', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier() })] });
    const id = await setup(f);
    const other = await setup(f, { name: 'other' });
    // The payload claims another connection and authentication; they are ignored.
    await f.services.inbound.receive(
      signed(id, { id: 'e1', operation: TASK, connectionId: other, authenticatedAt: 1 }),
    );
    expect(f.database.prepare('SELECT connection_id FROM integration_deliveries').all()).toEqual([
      { connection_id: id },
    ]);
    // A verified payload naming another project is refused: a project connection serves its own.
    await expect(
      f.services.inbound.receive(signed(id, { id: 'e2', operation: TASK, project: 'lib' })),
    ).rejects.toThrow(/does not apply/);
    expect(f.performed).toHaveLength(1);
  });

  it('serves a project named by a global connection, and only a registered one', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier() })] });
    const id = await setup(f, { global: true });
    await f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK, project: 'lib' }));
    expect(f.performed[0]?.project).toBe('/work/lib');
    await expect(
      f.services.inbound.receive(signed(id, { id: 'e2', operation: TASK })),
    ).rejects.toThrow(/not registered/);
    await expect(
      f.services.inbound.receive(signed(id, { id: 'e3', operation: TASK, project: '/nowhere' })),
    ).rejects.toThrow(/not registered/);
  });

  it('refuses a connection that is off, incomplete or pending, before the secret is read', async () => {
    const spy = { calls: 0 };
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier(spy) })] });
    const id = await setup(f);
    f.services.connections.disable(id);
    await expect(
      f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK })),
    ).rejects.toThrow(/disabled/);
    await expect(
      f.services.inbound.receive(signed('missing', { id: 'e1', operation: TASK })),
    ).rejects.toThrow(/authentication failed/);
    expect(spy.calls).toBe(0);
  });

  it('refuses an operation the kind does not allow', async () => {
    const narrow = { ...EXAMPLE, operations: ['queue_task'] as const };
    const f = fixture({ adapters: [{ descriptor: narrow, verifier: hmacVerifier() }] });
    const id = await setup(f);
    await expect(
      f.services.inbound.receive(
        signed(id, { id: 'e1', operation: { type: 'cancel_run', runId: 'r1' } }),
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      f.services.inbound.receive(
        signed(id, { id: 'e2', operation: { type: 'run_shell', command: 'x' } }),
      ),
    ).rejects.toThrow(/authentication failed/);
    expect(f.performed).toEqual([]);
  });

  it('answers a repeat with the recorded result, also after a restart, and keeps ids per connection', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier() })] });
    const id = await setup(f);
    const other = await setup(f, { name: 'other' });
    await f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    const again = await f.restart().inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    expect(again).toEqual({ status: 'duplicate', connectionId: id, result: { queued: true } });
    expect(f.performed).toHaveLength(1);
    await f.services.inbound.receive(signed(other, { id: 'e1', operation: TASK }));
    expect(f.performed).toHaveLength(2);
  });

  it('claims once when the same event arrives twice at the same time', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: hmacVerifier() })] });
    const id = await setup(f);
    const outcomes = await Promise.all([
      f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK })),
      f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK })),
    ]);
    expect(f.performed).toHaveLength(1);
    expect(outcomes.map((one) => one.status).sort()).toEqual(['applied', 'unknown_outcome']);
  });

  it('keeps an event whose outcome is unknown claimed and never repeats it', async () => {
    const f = fixture({
      adapters: [exampleAdapter({ verifier: hmacVerifier() })],
      operations: () => new Promise(() => undefined),
      overrides: { limits: { deadlineMs: 30 } },
    });
    const id = await setup(f);
    const first = await f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    expect(first).toEqual({ status: 'unknown_outcome', connectionId: id });
    const second = await f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    const afterRestart = await f
      .restart()
      .inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    expect(second.status).toBe('unknown_outcome');
    expect(afterRestart.status).toBe('unknown_outcome');
    expect(f.performed).toHaveLength(1);
    expect(f.database.prepare('SELECT state FROM integration_deliveries').all()).toEqual([
      { state: 'processing' },
    ]);
  });

  it('gives the id back after a refusal of the domain and tells nothing of it', async () => {
    let refuse = true;
    const f = fixture({
      adapters: [exampleAdapter({ verifier: hmacVerifier() })],
      operations: () =>
        refuse ? Promise.reject(rejected(`bad ${SENTINEL}`)) : Promise.resolve({ queued: true }),
    });
    const id = await setup(f);
    const error = await f.services.inbound
      .receive(signed(id, { id: 'e1', operation: TASK }))
      .catch((caught: Error) => caught);
    expect(String((error as Error).message)).not.toContain(SENTINEL);
    refuse = false;
    const retried = await f.services.inbound.receive(signed(id, { id: 'e1', operation: TASK }));
    expect(retried.status).toBe('applied');
  });

  it('gives up on a verifier that does not answer in time', async () => {
    const slow: InboundVerifierPort = { verify: () => new Promise(() => undefined) };
    const f = fixture({
      adapters: [exampleAdapter({ verifier: slow })],
      overrides: { limits: { deadlineMs: 20 } },
    });
    const id = await setup(f);
    await expect(
      f.services.inbound.receive({
        verifier: 'example',
        connectionId: id,
        body: new Uint8Array(),
        headers: {},
      }),
    ).rejects.toThrow(/timed out/);
    expect(f.performed).toEqual([]);
  });

  it('refuses a kind without a registered verifier', async () => {
    const f = fixture();
    const id = await setup(f);
    await expect(
      f.services.inbound.receive({
        verifier: 'example',
        connectionId: id,
        body: new Uint8Array(),
        headers: {},
      }),
    ).rejects.toThrow(/authentication failed/);
    await expect(
      f.services.inbound.receive({
        verifier: 'unknown',
        connectionId: id,
        body: new Uint8Array(),
        headers: {},
      }),
    ).rejects.toThrow(/authentication failed/);
  });
});

/** A verifier that only checks the event and asks for nothing: the id comes from the body. */
function ignoring(reason = 'no_rule'): InboundVerifierPort {
  return {
    verify: (context) =>
      Promise.resolve(
        context.ignore(new TextDecoder().decode(context.body), reason, {
          type: 'x.y',
          path: `a/${'p'.repeat(200)}\n`,
        }),
      ),
  };
}

describe('a verified event that asks for nothing', () => {
  const request = (id: string, connectionId: string): InboundRequest => ({
    verifier: 'example',
    connectionId,
    body: new TextEncoder().encode(id),
    headers: {},
  });

  it('is ignored without the domain, claims its id and is a duplicate the second time', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: ignoring() })] });
    const id = await setup(f);
    const seen: unknown[] = [];
    const first = await f.services.inbound.receive({
      ...request('e1', id),
      onVerified: (meta) => seen.push(meta),
    });
    expect(first).toEqual({ status: 'ignored', connectionId: id, reason: 'no_rule' });
    expect(f.performed).toEqual([]);
    const again = await f.restart().inbound.receive(request('e1', id));
    expect(again).toEqual({
      status: 'duplicate',
      connectionId: id,
      result: { ignored: 'no_rule' },
    });
    expect(seen).toEqual([{ type: 'x.y', path: `a/${'p'.repeat(126)}` }]);
  });

  it('needs neither an allowed operation nor a project, but still a live connection', async () => {
    const none = { ...EXAMPLE, operations: [] as const };
    const f = fixture({ adapters: [{ descriptor: none, verifier: ignoring() }] });
    const id = await setup(f);
    f.services.connections.disable(id);
    await expect(f.services.inbound.receive(request('e1', id))).rejects.toThrow(/disabled/);
    await f.services.connections.enable(id);
    expect((await f.services.inbound.receive(request('e1', id))).status).toBe('ignored');
  });

  it('refuses a reason that is not a static word and a proof of another delivery', async () => {
    const f = fixture({ adapters: [exampleAdapter({ verifier: ignoring('has space') })] });
    const id = await setup(f);
    await expect(f.services.inbound.receive(request('e1', id))).rejects.toThrow(
      /authentication failed/,
    );
    let kept: VerifiedToken | null = null;
    const replaying: InboundVerifierPort = {
      async verify(context) {
        kept ??= context.ignore('e2', 'recovery');
        return kept;
      },
    };
    const g = fixture({ adapters: [exampleAdapter({ verifier: replaying })] });
    const other = await setup(g);
    await g.services.inbound.receive(request('x', other));
    await expect(g.services.inbound.receive(request('x', other))).rejects.toThrow(
      /authentication failed/,
    );
  });
});

describe('outbound operations', () => {
  it('runs only through an enabled connection that serves the project and reports a failure as one', async () => {
    const outbound = {
      perform: async (request: {
        secrets: { read(slot: string): Promise<string> };
        payload: Record<string, string>;
      }) => {
        expect(await request.secrets.read('token')).toBe('shared-secret');
        if (request.payload.fail) throw new Error(SENTINEL);
        return { sent: true };
      },
    };
    const f = fixture({ adapters: [exampleAdapter({ outbound })] });
    const id = await setup(f);
    await expect(
      f.services.outbound.perform({ connectionId: id, project: '/work/lib', action: 'notify' }),
    ).rejects.toThrow(/does not apply/);
    expect(
      await f.services.outbound.perform({
        connectionId: id,
        project: '/work/app',
        action: 'notify',
      }),
    ).toEqual({ ok: true, result: { sent: true } });
    const failed = await f.services.outbound.perform({
      connectionId: id,
      project: '/work/app',
      action: 'notify',
      payload: { fail: '1' },
    });
    expect(failed).toEqual({ ok: false, code: 'failed' });
    expect(JSON.stringify(failed)).not.toContain(SENTINEL);
  });

  it('reports a timeout as a failure, not as success', async () => {
    const hung = { perform: () => new Promise<never>(() => undefined) };
    const f = fixture({
      adapters: [exampleAdapter({ outbound: hung })],
      overrides: { outboundTimeoutMs: 20 },
    });
    const id = await setup(f);
    expect(
      await f.services.outbound.perform({ connectionId: id, project: '/work/app', action: 'x' }),
    ).toEqual({ ok: false, code: 'timeout' });
  });

  it('refuses a kind without an outbound part', async () => {
    const f = fixture();
    const id = await setup(f);
    await expect(
      f.services.outbound.perform({ connectionId: id, project: '/work/app', action: 'x' }),
    ).rejects.toThrow(/not allowed/);
  });
});
