import { describe, expect, it } from 'vitest';

import { tabRoute } from '../src/app/state/tabRoute.ts';
import { formatRoute, type Route } from '../src/shared/lib/nav/route.ts';

const runs: Route = { view: 'runs', run: 'mwci7xaswlhy', group: 'g1', step: null, tab: null };

describe('tabRoute', () => {
  it('opens statistics without the id of the last run', () => {
    const next = tabRoute('stats', runs, 'mwci7xaswlhy');
    expect(next.run).toBeNull();
    expect(formatRoute(next)).toBe('#stats?period=30d');
  });

  it('returns from statistics to the last run', () => {
    const stats = tabRoute('stats', runs, 'mwci7xaswlhy');
    expect(tabRoute('runs', stats, 'mwci7xaswlhy').run).toBe('mwci7xaswlhy');
  });

  it('keeps the route of the current section', () => {
    expect(tabRoute('runs', runs, 'other')).toBe(runs);
  });

  it('opens the other sections as before', () => {
    expect(tabRoute('queue', runs, 'x').run).toBeNull();
    expect(tabRoute('specialists', runs, 'x').run).toBeNull();
    expect(tabRoute('pipelines', runs, 'x').run).toBeNull();
    const settings = tabRoute('settings', runs, 'x');
    expect([settings.run, settings.group]).toEqual(['general', 'global']);
  });
});
