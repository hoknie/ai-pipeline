import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../../../src/platform/sqlite/index.ts';
import {
  ConnectionRepository,
  DeliveryRepository,
  SecretRepository,
} from '../../../src/feature/integrations/repositories/index.ts';
import type { Connection } from '../../../src/feature/integrations/types/index.ts';

import { SENTINEL, fixture } from './helpers.ts';

const connection = (patch: Partial<Connection> = {}): Connection => ({
  id: 'c1',
  kind: 'example',
  name: 'main',
  scope: 'project',
  projectPath: '/work/app',
  params: { account: 'acme' },
  enabled: false,
  state: 'ready',
  createdAt: 1,
  updatedAt: 1,
  lastCheck: null,
  ...patch,
});

describe('migration of the integrations', () => {
  it('adds the tables to an older database and keeps what it had', () => {
    const old = new DatabaseSync(':memory:');
    MIGRATIONS.slice(0, -10).forEach((sql) => old.exec(sql));
    old.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 10}`);
    old
      .prepare(
        "INSERT INTO runs (id, repository, pipeline, base_commit, branch, created_at, config_json, dirty_warning, next_merge_seq) VALUES ('r1', '/repo', 'f', 'abc', 'b', 1, '{}', 0, 0)",
      )
      .run();
    migrate(old);
    const tables = (
      old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'integration_connections',
        'integration_secret_slots',
        'integration_secret_operations',
        'integration_deliveries',
      ]),
    );
    expect(old.prepare('SELECT id FROM runs').all()).toEqual([{ id: 'r1' }]);
    migrate(old);
    old.close();
  });
});

describe('connection repository', () => {
  it('keeps one name per kind in a scope, but the same name in another project or scope', () => {
    const { database } = fixture();
    const repository = new ConnectionRepository(database);
    repository.insert(connection());
    expect(() => repository.insert(connection({ id: 'c2' }))).toThrow();
    repository.insert(connection({ id: 'c3', projectPath: '/work/lib' }));
    repository.insert(connection({ id: 'c4', scope: 'global', projectPath: null }));
    expect(() =>
      repository.insert(connection({ id: 'c5', scope: 'global', projectPath: null })),
    ).toThrow();
    expect(repository.all().map((one) => one.id)).toEqual(['c1', 'c3', 'c4']);
    expect(repository.find('c1')?.params).toEqual({ account: 'acme' });
  });

  it('moves the project of its connections and counts them', () => {
    const { database } = fixture();
    const repository = new ConnectionRepository(database);
    repository.insert(connection());
    repository.moveProject('/work/app', '/work/new');
    expect(repository.find('c1')?.projectPath).toBe('/work/new');
    expect(repository.countOfProject('/work/app')).toBe(0);
    expect(repository.countOfProject('/work/new')).toBe(1);
  });
});

describe('secret repository', () => {
  it('switches the generation by compare and swap', () => {
    const { database } = fixture();
    new ConnectionRepository(database).insert(connection());
    const secrets = new SecretRepository(database);
    expect(secrets.switchGeneration('c1', 'token', null, 'g1', 1)).toBe(true);
    // Someone else created the slot first.
    expect(secrets.switchGeneration('c1', 'token', null, 'g2', 2)).toBe(false);
    expect(secrets.switchGeneration('c1', 'token', 'gX', 'g2', 2)).toBe(false);
    expect(secrets.switchGeneration('c1', 'token', 'g1', 'g2', 2)).toBe(true);
    expect(secrets.slot('c1', 'token')).toMatchObject({ generation: 'g2', version: 2 });
    expect(secrets.clearGeneration('c1', 'token', 'g1')).toBe(false);
    expect(secrets.clearGeneration('c1', 'token', 'g2')).toBe(true);
    expect(secrets.slot('c1', 'token')).toBeUndefined();
  });

  it('keeps one unfinished operation per slot', () => {
    const { database } = fixture();
    new ConnectionRepository(database).insert(connection());
    const secrets = new SecretRepository(database);
    const operation = {
      connectionId: 'c1',
      slot: 'token',
      kind: 'write' as const,
      phase: 'pending_write' as const,
      previousGeneration: null,
      nextGeneration: 'g1',
      createdAt: 1,
    };
    secrets.insertOperation(operation);
    expect(() => secrets.insertOperation(operation)).toThrow();
    const stored = secrets.operationOf('c1', 'token')!;
    secrets.setPhase(stored.id, 'pending_cleanup');
    expect(secrets.operations('c1')[0]?.phase).toBe('pending_cleanup');
    expect(secrets.connectionsWithOperations()).toEqual(['c1']);
    secrets.deleteOperation(stored.id);
    expect(secrets.operations()).toEqual([]);
  });
});

describe('delivery repository', () => {
  it('claims an event id once per connection', () => {
    const { database } = fixture();
    const connections = new ConnectionRepository(database);
    connections.insert(connection());
    connections.insert(connection({ id: 'c2', name: 'backup' }));
    const deliveries = new DeliveryRepository(database);
    expect(deliveries.claim('c1', 'e1', 1)).toBe(true);
    expect(deliveries.claim('c1', 'e1', 2)).toBe(false);
    expect(deliveries.claim('c2', 'e1', 2)).toBe(true);
    deliveries.markApplied('c1', 'e1', { queued: true }, 3);
    expect(deliveries.find('c1', 'e1')).toMatchObject({
      state: 'applied',
      result: { queued: true },
    });
    deliveries.release('c1', 'e1');
    expect(deliveries.find('c1', 'e1')?.state).toBe('applied');
    deliveries.release('c2', 'e1');
    expect(deliveries.find('c2', 'e1')).toBeUndefined();
  });
});

describe('what SQLite holds', () => {
  it('never holds a secret value', async () => {
    const f = fixture();
    const { connections } = f.services;
    const created = await connections.add({ kind: 'example', name: 'main', repository: 'app' });
    await connections.setSecret(created.id, 'token', SENTINEL);
    await connections.setSecret(created.id, 'token', `${SENTINEL}-2`);
    const dump = [
      'integration_connections',
      'integration_secret_slots',
      'integration_secret_operations',
      'integration_deliveries',
    ]
      .map((table) => JSON.stringify(f.database.prepare(`SELECT * FROM ${table}`).all()))
      .join('\n');
    expect(dump).not.toContain(SENTINEL);
    expect([...f.store.values.values()]).toContain(`${SENTINEL}-2`);
  });
});
