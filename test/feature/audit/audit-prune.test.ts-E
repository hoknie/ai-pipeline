import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUDIT_PRUNE_MS, createAuditPruner } from '../../../src/app/lifecycle.ts';
import { createAuditServices } from '../../../src/feature/audit/services/index.ts';
import type { NewAuditEvent } from '../../../src/feature/audit/types/index.ts';
import { defaultServer } from '../../../src/feature/swarm-config/types/index.ts';
import { temporaryStorage } from '../storage.ts';

const DAY = 86_400_000;

afterEach(() => vi.useRealTimers());

function entry(at: number): NewAuditEvent {
  return {
    at,
    subject: 'u1',
    action: 'run.cancel',
    repository: null,
    resourceKind: null,
    resourceId: null,
    outcome: 'ok',
    details: {},
    error: null,
  };
}

function setup(server: Partial<ReturnType<typeof defaultServer>> | string) {
  const store = temporaryStorage();
  const { log } = createAuditServices({ database: store.database });
  let clock = 100 * DAY;
  const messages: string[] = [];
  const pruner = createAuditPruner(
    {
      audit: log,
      now: () => clock,
      config: {
        serverSettings: () =>
          typeof server === 'string' ? server : { ...defaultServer(), ...server },
      },
    } as never,
    (message) => messages.push(message),
  );
  return { store, log, pruner, messages, advance: (ms: number) => (clock += ms) };
}

describe('the daily clearing of the audit journal', () => {
  it('deletes an entry older than audit_retention, and keeps the others', () => {
    const { store, log, pruner } = setup({ enabled: true, auditRetention: '30d' });
    log.record(entry(100 * DAY - 40 * DAY));
    log.record(entry(100 * DAY - 29 * DAY));
    expect(pruner.prune()).toBe(1);
    expect(log.list({}).map((event) => event.at)).toEqual([71 * DAY]);
    store.database.close();
  });

  it('keeps a year by default', () => {
    const { store, log, pruner, advance } = setup({ enabled: true });
    advance(300 * DAY);
    log.record(entry(10 * DAY));
    log.record(entry(100 * DAY));
    expect(pruner.prune()).toBe(1);
    expect(log.list({}).map((event) => event.at)).toEqual([100 * DAY]);
    store.database.close();
  });

  it('runs at the start and then every day by the clock of timers', () => {
    vi.useFakeTimers();
    const { store, log, pruner, advance } = setup({ enabled: true, auditRetention: '30d' });
    log.record(entry(100 * DAY - 40 * DAY));
    pruner.start();
    expect(log.list({})).toHaveLength(0);
    log.record(entry(100 * DAY - 31 * DAY));
    expect(log.list({})).toHaveLength(1);
    advance(AUDIT_PRUNE_MS);
    vi.advanceTimersByTime(AUDIT_PRUNE_MS);
    expect(log.list({})).toHaveLength(0);
    pruner.stop();
    log.record(entry(1));
    advance(AUDIT_PRUNE_MS);
    vi.advanceTimersByTime(AUDIT_PRUNE_MS);
    expect(log.list({})).toHaveLength(1);
    store.database.close();
  });

  it('does nothing in the local mode', () => {
    const { store, log, pruner } = setup({ enabled: false, auditRetention: '1d' });
    log.record(entry(1));
    expect(pruner.prune()).toBe(0);
    expect(log.list({})).toHaveLength(1);
    store.database.close();
  });

  it('writes a failure to the log of the daemon and goes on', () => {
    const { store, pruner, messages } = setup({ enabled: true });
    store.database.close();
    expect(pruner.prune()).toBe(0);
    expect(messages[0]).toContain('audit: cannot clear the journal');
  });
});
