import { describe, expect, it } from 'vitest';

import { tabRoute } from '../src/app/state/tabRoute.ts';
import { formatRoute, parseRoute, type Route } from '../src/shared/lib/nav/route.ts';

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

  it('leads from the page of a new task to the queue', () => {
    const page: Route = { view: 'queue', run: 'new', group: null, step: null, tab: null };
    expect(formatRoute(tabRoute('queue', page, 'x'))).toBe('#queue');
  });

  it('opens the other sections as before', () => {
    expect(tabRoute('queue', runs, 'x').run).toBeNull();
    expect(tabRoute('specialists', runs, 'x').run).toBeNull();
    expect(tabRoute('pipelines', runs, 'x').run).toBeNull();
    const settings = tabRoute('settings', runs, 'x');
    expect([settings.run, settings.group]).toEqual(['general', 'global']);
  });
});

describe('the addresses of the group «Swarm» of the settings', () => {
  it.each([
    '#settings/global/swarm/providers/new?preset=zai',
    '#settings/project/swarm/pipelines/topology/feature/variant-b',
    '#settings/project/swarm/pipelines/actions',
    '#settings/project/swarm/pipelines/system/stage',
    '#settings/project/swarm/pipelines/feature',
    '#settings/global/swarm/chains/thinking',
  ])('keeps %s through parse and format', (hash) => {
    expect(formatRoute(parseRoute(hash))).toBe(hash);
  });

  it('reads the preset, the variant and the section without an entry', () => {
    expect(parseRoute('#settings/global/swarm/providers/new?preset=zai').preset).toBe('zai');
    const topology = parseRoute('#settings/project/swarm/pipelines/topology/feature/b');
    expect([topology.section, topology.step, topology.variant]).toEqual([
      'topology',
      'feature',
      'b',
    ]);
    const actions = parseRoute('#settings/project/swarm/pipelines/actions');
    expect([actions.section, actions.step]).toEqual(['actions', null]);
  });
});
