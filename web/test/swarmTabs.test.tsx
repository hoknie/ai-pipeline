import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetSwarm,
  lastSwarmTab,
  recalledSwarm,
  rememberSwarm,
  routeOfSwarmTarget,
  swarmTabOf,
  swarmTargetOfRoute,
  SWARM_TABS,
} from '../src/features/swarm/index.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';

beforeEach(forgetSwarm);

describe('the tabs of the window', () => {
  it('follow the order of the entities', () => {
    expect([...SWARM_TABS]).toEqual(['providers', 'roles', 'chains', 'specialists', 'pipelines']);
    expect(swarmTabOf('nope')).toBe('specialists');
    expect(swarmTabOf(null)).toBe('specialists');
  });

  it('map the addresses of the top bar to tabs and back', () => {
    const places: [string, string][] = [
      ['#providers', 'providers'],
      ['#providers/zai', 'providers'],
      ['#providers/roles', 'roles'],
      ['#specialists/coder', 'specialists'],
      ['#specialists/chains/fast', 'chains'],
      ['#pipelines/feature', 'pipelines'],
      ['#pipelines/actions/commit', 'pipelines'],
    ];
    for (const [hash, tab] of places) {
      const target = swarmTargetOfRoute(parseRoute(hash));
      expect(target.tab).toBe(tab);
      expect(formatRoute(routeOfSwarmTarget(target))).toBe(hash);
    }
  });
});

describe('the memory of the session', () => {
  it('opens «Specialists» first and then the last tab of the project area', () => {
    expect(lastSwarmTab()).toBe('specialists');
    rememberSwarm('project', { tab: 'chains', entry: 'fast' });
    expect(lastSwarmTab()).toBe('chains');
    rememberSwarm('global', { tab: 'roles', entry: null });
    expect(lastSwarmTab()).toBe('chains');
  });

  it('brings back the last entry of a tab, but not a new one', () => {
    rememberSwarm('project', { tab: 'providers', entry: 'zai' });
    rememberSwarm('project', { tab: 'specialists', entry: 'new' });
    expect(recalledSwarm('project', 'providers')).toEqual({ tab: 'providers', entry: 'zai' });
    expect(recalledSwarm('project', 'specialists').entry).toBeNull();
    expect(recalledSwarm('global', 'providers')).toEqual({ tab: 'providers', entry: null });
  });
});
