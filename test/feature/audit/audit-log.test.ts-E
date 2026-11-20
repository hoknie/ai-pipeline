import { describe, expect, it } from 'vitest';

import { createAuditServices } from '../../../src/feature/audit/services/index.ts';
import { AUDIT_TEXT_LIMIT, type NewAuditEvent } from '../../../src/feature/audit/types/index.ts';
import { temporaryStorage } from '../storage.ts';

function entry(extra: Partial<NewAuditEvent> = {}): NewAuditEvent {
  return {
    at: 1000,
    subject: 'u1',
    action: 'run.cancel',
    repository: '/repo',
    resourceKind: 'run',
    resourceId: 'r1',
    outcome: 'ok',
    details: {},
    error: null,
    ...extra,
  };
}

function open() {
  const store = temporaryStorage();
  return { store, log: createAuditServices({ database: store.database }).log };
}

describe('the audit journal', () => {
  it('lists the newest entries first, the same moment by the order of writing', () => {
    const { store, log } = open();
    log.record(entry({ at: 1000, resourceId: 'a' }));
    log.record(entry({ at: 3000, resourceId: 'c' }));
    log.record(entry({ at: 3000, resourceId: 'd' }));
    log.record(entry({ at: 2000, resourceId: 'b' }));
    expect(log.list({}).map((event) => event.resourceId)).toEqual(['d', 'c', 'b', 'a']);
    store.database.close();
  });

  it('keeps every field, the details as they were', () => {
    const { store, log } = open();
    log.record(
      entry({ outcome: 'failed', error: 'boom', details: { group: 'login', answer: 'yes' } }),
    );
    expect(log.list({})[0]).toMatchObject({
      subject: 'u1',
      action: 'run.cancel',
      repository: '/repo',
      resourceKind: 'run',
      resourceId: 'r1',
      outcome: 'failed',
      error: 'boom',
      details: { group: 'login', answer: 'yes' },
    });
    store.database.close();
  });

  it('filters by subject, project, action prefix and moment, together', () => {
    const { store, log } = open();
    log.record(entry({ at: 1000, subject: 'u1', action: 'run.cancel' }));
    log.record(entry({ at: 2000, subject: 'u2', action: 'run.answer', repository: '/other' }));
    log.record(entry({ at: 3000, subject: 'u2', action: 'config.write', repository: '/repo' }));
    log.record(entry({ at: 4000, subject: 'system', action: 'run.apply', repository: null }));
    expect(log.list({ subject: 'u2' })).toHaveLength(2);
    expect(log.list({ repository: '/repo' })).toHaveLength(2);
    expect(log.list({ action: 'run.' }).map((event) => event.action)).toEqual([
      'run.apply',
      'run.answer',
      'run.cancel',
    ]);
    expect(log.list({ since: 2500 })).toHaveLength(2);
    expect(log.list({ subject: 'u2', action: 'run.', since: 1500 })).toHaveLength(1);
    store.database.close();
  });

  it('takes `%` and `_` of the action filter literally', () => {
    const { store, log } = open();
    log.record(entry({ action: 'run.cancel' }));
    expect(log.list({ action: 'run_' })).toHaveLength(0);
    expect(log.list({ action: '%' })).toHaveLength(0);
    store.database.close();
  });

  it('limits the answer, by default to 200 and never above 1000', () => {
    const { store, log } = open();
    store.database.transaction(() => {
      for (let index = 0; index < 250; index += 1) log.record(entry({ at: index }));
    });
    expect(log.list({ limit: 5 })).toHaveLength(5);
    expect(log.list({})).toHaveLength(200);
    expect(log.list({ limit: 5000 })).toHaveLength(250);
    store.database.close();
  });

  it('deletes the entries older than the moment and keeps the others', () => {
    const { store, log } = open();
    log.record(entry({ at: 100 }));
    log.record(entry({ at: 200 }));
    log.record(entry({ at: 300 }));
    expect(log.prune(250)).toBe(2);
    expect(log.list({}).map((event) => event.at)).toEqual([300]);
    store.database.close();
  });

  it('cuts the error text to the limit', () => {
    const { store, log } = open();
    log.record(entry({ outcome: 'failed', error: 'x'.repeat(AUDIT_TEXT_LIMIT + 500) }));
    expect(log.list({})[0]?.error).toHaveLength(AUDIT_TEXT_LIMIT);
    store.database.close();
  });
});
