import { describe, expect, it } from 'vitest';

import { requestSchema } from '../../../src/presentation/ipc/contract/index.ts';
import { auditActions } from '../../../src/presentation/ipc/handlers/audit/audit-table.ts';
import {
  readingMethods,
  workerMethods,
} from '../../../src/presentation/ipc/handlers/audit/audit-readers.ts';

const METHODS = requestSchema.options.map((option) => option.shape.method.value as string);

describe('the table of the audit actions', () => {
  it('has every method of the contract in the table, among the readers or among the workers', () => {
    const known = new Set<string>([
      ...Object.keys(auditActions),
      ...readingMethods,
      ...workerMethods,
    ]);
    expect(METHODS.filter((method) => !known.has(method))).toEqual([]);
  });

  it('lists every method once and names no method that does not exist', () => {
    const all = [...Object.keys(auditActions), ...readingMethods, ...workerMethods];
    expect(all.filter((method, index) => all.indexOf(method) !== index)).toEqual([]);
    expect(all.filter((method) => !METHODS.includes(method))).toEqual([]);
  });

  it('names the action of the methods that write shared settings and of the projects', () => {
    const action = (method: keyof typeof auditActions, params: Record<string, unknown>) => {
      const row = auditActions[method]!;
      return typeof row.action === 'function' ? row.action(params) : row.action;
    };
    expect(action('config_write', { level: 'global' })).toBe('config.global.write');
    expect(action('config_write', {})).toBe('config.write');
    expect(action('config_setting', { level: 'global' })).toBe('config.global.write');
    expect(action('config_setting', { level: 'project' })).toBe('config.write');
    expect(action('specialist_tags_set', { repository: null })).toBe('config.global.write');
    expect(action('specialist_tags_set', { repository: '/app' })).toBe('config.write');
    expect(action('specialists_import', {})).toBe('config.global.write');
    expect(action('pipelines_import', {})).toBe('config.global.write');
    expect(action('observers_set', {})).toBe('config.global.write');
    expect(action('repository_add', {})).toBe('project.add');
    expect(action('repository_update', {})).toBe('project.update');
    expect(action('repository_move', {})).toBe('project.update');
    expect(action('repository_remove', {})).toBe('project.remove');
    expect(action('stats_clear', {})).toBe('stats.clear');
  });

  it('keeps the event names of the account methods apart from their action', () => {
    expect(
      [
        'users_set',
        'users_disable',
        'users_enable',
        'login_link_create',
        'tokens_create',
        'tokens_revoke',
      ].map((method) => auditActions[method as keyof typeof auditActions]?.event),
    ).toEqual([
      'user.attributes',
      'user.disable',
      'user.enable',
      'login_link.create',
      'token.create',
      'token.revoke',
    ]);
  });

  it('keeps secrets out of the details', () => {
    const secrets = { id: 'c1', slot: 'token', value: 'S3CRET', token: 'T0KEN', code: 'C0DE' };
    for (const method of [
      'integration_secret_set',
      'tokens_create',
      'tokens_revoke',
      'auth_link_login',
      'cli_login_exchange',
    ] as const) {
      const info = auditActions[method]!.info?.(
        { ...secrets, name: 'laptop' },
        undefined,
        {} as never,
      );
      expect(JSON.stringify(info)).not.toMatch(/S3CRET|T0KEN|C0DE/);
    }
  });

  it('cuts the answer to a question to 2000 characters', () => {
    const info = auditActions.answer!.info?.(
      { runId: 'r', group: 'login', answer: 'x'.repeat(5000) },
      undefined,
      {} as never,
    );
    expect((info?.details?.answer as string).length).toBe(2000);
    expect(info?.details?.group).toBe('login');
  });
});
