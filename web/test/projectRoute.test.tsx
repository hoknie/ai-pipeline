import { describe, expect, it } from 'vitest';

import { formatRoute, parseRoute, type Route } from '../src/shared/lib/nav/route.ts';

const runs: Route = { view: 'runs', run: 'mwci7xaswlhy', group: 'g1', step: null, tab: null };

describe('the project of an entry in the address', () => {
  it('reads and writes `?project=` of specialists and pipelines', () => {
    expect(parseRoute('#specialists/tester?project=lib')).toMatchObject({
      view: 'specialists',
      run: 'tester',
      project: 'lib',
    });
    expect(parseRoute('#pipelines/feature?project=app')).toMatchObject({
      view: 'pipelines',
      run: 'feature',
      project: 'app',
    });
    expect(parseRoute('#specialists/tester').project ?? null).toBeNull();
    const route = parseRoute('#specialists/tester?project=lib');
    expect(formatRoute(route)).toBe('#specialists/tester?project=lib');
    expect(formatRoute({ ...route, group: 'chains' })).toBe(
      '#specialists/chains/tester?project=lib',
    );
    expect(formatRoute(parseRoute('#pipelines/topology/feature/fast?project=lib'))).toBe(
      '#pipelines/topology/feature/fast?project=lib',
    );
  });

  it('leaves the other sections without a project', () => {
    expect(formatRoute({ ...runs, project: 'lib' })).toBe('#runs/mwci7xaswlhy/g1');
    expect(parseRoute('#queue?project=lib').project ?? null).toBeNull();
  });
});
