import { describe, expect, it } from 'vitest';

import {
  isAdmin,
  isTokenFormat,
  parseAttributeArgument,
  parseTtl,
  tokenStart,
} from '../../../src/feature/identity/types/index.ts';

const user = (attributes: Record<string, string[]>) =>
  ({
    kind: 'user',
    user: { id: 'u', email: 'a@example.com', name: 'A' },
    attributes,
  }) as const;

describe('identity types', () => {
  it('treat local and system as administrators and users by role', () => {
    expect(isAdmin({ kind: 'local' })).toBe(true);
    expect(isAdmin({ kind: 'system' })).toBe(true);
    expect(isAdmin(user({ role: ['admin'] }))).toBe(true);
    expect(isAdmin(user({ role: ['dev'] }))).toBe(false);
    expect(isAdmin(user({}))).toBe(false);
  });

  it('parse durations', () => {
    expect(parseTtl('15m')).toBe(900_000);
    expect(parseTtl('12h')).toBe(43_200_000);
    expect(parseTtl('7d')).toBe(604_800_000);
    expect(parseTtl('soon')).toBeNull();
    expect(parseTtl('0d')).toBeNull();
    expect(parseTtl('5')).toBeNull();
  });

  it('recognise the token format and show its start', () => {
    const value = `aip_pat_${'a'.repeat(43)}`;
    expect(isTokenFormat(value)).toBe(true);
    expect(isTokenFormat('aip_pat_short')).toBe(false);
    expect(isTokenFormat(`other_${'a'.repeat(43)}`)).toBe(false);
    expect(tokenStart(value)).toBe('aip_pat_aaaa');
  });

  it('parse an attribute argument', () => {
    expect(parseAttributeArgument('role=admin,dev')).toEqual(['role', ['admin', 'dev']]);
    expect(parseAttributeArgument('team=')).toEqual(['team', []]);
    expect(parseAttributeArgument('nothing')).toBeNull();
  });
});
