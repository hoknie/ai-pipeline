import { describe, expect, it } from 'vitest';

import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';

describe('the route of the statistics', () => {
  it('opens the default period for a bare address', () => {
    expect(parseRoute('#stats')).toMatchObject({ view: 'stats', group: '30d', run: null });
  });

  it('reads the period and the project', () => {
    expect(parseRoute('#stats?period=90d&project=%2Fwork%2Fapp')).toMatchObject({
      view: 'stats',
      group: '90d',
      run: '/work/app',
    });
  });

  it('turns an unknown period into 30 days', () => {
    expect(parseRoute('#stats?period=5y').group).toBe('30d');
  });

  it('builds the address back, with a path containing slashes', () => {
    const route = parseRoute('#stats?period=7d&project=%2Fwork%2Fapp');
    expect(formatRoute(route)).toBe('#stats?period=7d&project=%2Fwork%2Fapp');
    expect(formatRoute(parseRoute('#stats?period=all'))).toBe('#stats?period=all');
  });
});
