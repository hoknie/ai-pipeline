import { describe, expect, it } from 'vitest';

import {
  claimText,
  claimValues,
  emailDomain,
  emailVerified,
  mapAttributes,
} from '../../../src/feature/identity/types/index.ts';

describe('claims', () => {
  it('turn a string into one element, an array into a list and a missing claim into nothing', () => {
    expect(claimValues({ dept: 'platform' }, 'dept')).toEqual(['platform']);
    expect(claimValues({ groups: ['dev', 'ops'] }, 'groups')).toEqual(['dev', 'ops']);
    expect(claimValues({}, 'groups')).toEqual([]);
    expect(claimValues({ groups: 5 }, 'groups')).toEqual([]);
    expect(claimValues({ groups: ['dev', 1, ''] }, 'groups')).toEqual(['dev']);
  });

  it('map attributes by claim names', () => {
    const claims = { groups: ['dev', 'ops'], dept: 'platform' };
    expect(mapAttributes(claims, { groups: 'groups', department: 'dept', team: 'team' })).toEqual({
      groups: ['dev', 'ops'],
      department: ['platform'],
      team: [],
    });
  });

  it('read the text, the verification flag and the domain', () => {
    expect(claimText({ name: 'Alice' }, 'name')).toBe('Alice');
    expect(claimText({}, 'name')).toBeNull();
    expect(emailVerified({ email_verified: true })).toBe(true);
    expect(emailVerified({ email_verified: 'true' })).toBe(true);
    expect(emailVerified({ email_verified: 'yes' })).toBe(false);
    expect(emailVerified({})).toBe(false);
    expect(emailDomain('Eve@Gmail.com')).toBe('gmail.com');
    expect(emailDomain('nobody')).toBeNull();
  });
});
