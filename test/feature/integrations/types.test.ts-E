import { describe, expect, it } from 'vitest';

import {
  connectionServes,
  failureCode,
  isOperation,
  refusal,
  secretKey,
  validateName,
  validateParams,
  validateSecretValue,
  type Connection,
} from '../../../src/feature/integrations/types/index.ts';

import { EXAMPLE, SENTINEL } from './helpers.ts';

const connection = (patch: Partial<Connection> = {}): Connection => ({
  id: 'c1',
  kind: 'example',
  name: 'main',
  scope: 'project',
  projectPath: '/work/app',
  params: {},
  enabled: true,
  state: 'ready',
  createdAt: 1,
  updatedAt: 1,
  lastCheck: null,
  ...patch,
});

describe('connection types', () => {
  it('accepts the declared parameters and refuses unknown ones, bad values and missing required ones', () => {
    expect(validateParams(EXAMPLE, { account: 'acme', region: 'eu' })).toEqual({
      account: 'acme',
      region: 'eu',
    });
    expect(() => validateParams(EXAMPLE, { token: SENTINEL })).toThrow(/invalid connection/);
    expect(() => validateParams(EXAMPLE, { region: 'asia' })).toThrow(/region/);
    expect(() => validateParams(EXAMPLE, { account: 'x'.repeat(41) })).toThrow(/account/);
    const required = { ...EXAMPLE, params: [{ name: 'org', required: true, maxLength: 5 }] };
    expect(() => validateParams(required, {})).toThrow(/org/);
  });

  it('never echoes a refused input', () => {
    for (const run of [
      () => validateParams(EXAMPLE, { [SENTINEL]: SENTINEL }),
      () => validateName(SENTINEL.toUpperCase()),
    ]) {
      try {
        run();
        throw new Error('not refused');
      } catch (error) {
        expect((error as Error).message).not.toContain(SENTINEL);
        expect((error as Error).message.toLowerCase()).not.toContain(SENTINEL);
      }
    }
  });

  it('validates names and secret values', () => {
    expect(() => validateName('main')).not.toThrow();
    for (const bad of ['', 'Main', 'a b', '-x', 'x'.repeat(41)]) {
      expect(() => validateName(bad)).toThrow();
    }
    expect(() => validateSecretValue('x')).not.toThrow();
    expect(() => validateSecretValue('')).toThrow();
    expect(() => validateSecretValue('x'.repeat(16 * 1024 + 1))).toThrow();
  });

  it('lets a project connection serve its own project only, and a global one any named project', () => {
    expect(connectionServes(connection(), '/work/app')).toBe(true);
    expect(connectionServes(connection(), '/work/lib')).toBe(false);
    expect(connectionServes(connection({ scope: 'global', projectPath: null }), '/work/lib')).toBe(
      true,
    );
  });

  it('builds store keys from ids that never change and tells operations apart', () => {
    expect(secretKey('i', 'c1', 'token', 'g1')).toBe('aip/i/c1/token/g1');
    expect(secretKey('i', 'c1', 'token', 'g2')).not.toBe(secretKey('i', 'c1', 'token', 'g1'));
    expect(isOperation({ type: 'queue_task', pipeline: 'feature', task: 'do it' })).toBe(true);
    expect(isOperation({ type: 'cancel_run', runId: 'r1' })).toBe(true);
    expect(isOperation({ type: 'run_shell', command: 'rm -rf /' })).toBe(false);
    expect(isOperation({ type: 'queue_task', pipeline: '', task: 'x' })).toBe(false);
    expect(isOperation(null)).toBe(false);
  });

  it('reads the code of a refusal back', () => {
    expect(failureCode(refusal('not_found'))).toBe('not_found');
    expect(failureCode(new Error('x'))).toBeNull();
  });
});
