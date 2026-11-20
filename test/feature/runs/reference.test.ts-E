import { describe, expect, it } from 'vitest';

import { parseRunReference } from '../../../src/feature/runs/types/index.ts';

describe('parseRunReference', () => {
  it('reads a run id', () => {
    expect(parseRunReference('mwdu7le2qp1u')).toEqual({
      kind: 'id',
      id: 'mwdu7le2qp1u',
      group: null,
    });
  });

  it('reads a task number with and without #', () => {
    expect(parseRunReference('333')).toEqual({ kind: 'number', number: 333 });
    expect(parseRunReference(' #333 ')).toEqual({ kind: 'number', number: 333 });
  });

  it('reads a panel link', () => {
    expect(parseRunReference('http://127.0.0.1:7341/#runs/mwdu7le2qp1u')).toEqual({
      kind: 'id',
      id: 'mwdu7le2qp1u',
      group: null,
    });
  });

  it('takes the group of a panel link and ignores the step and the tab', () => {
    expect(
      parseRunReference('http://localhost:9000/#runs/mwdu7le2qp1u/fix%20login/coder?tab=log'),
    ).toEqual({ kind: 'id', id: 'mwdu7le2qp1u', group: 'fix login' });
    expect(parseRunReference('#runs/mwdu7le2qp1u/fix-login?tab=log')).toEqual({
      kind: 'id',
      id: 'mwdu7le2qp1u',
      group: 'fix-login',
    });
  });

  it('refuses anything else', () => {
    expect(parseRunReference('')).toBeNull();
    expect(parseRunReference('run 333')).toBeNull();
    expect(parseRunReference('http://127.0.0.1:7341/#runs')).toBeNull();
    expect(parseRunReference('#runs/Bad%ZZ')).toBeNull();
    expect(parseRunReference('#runs/ABC')).toBeNull();
  });
});
