import { describe, expect, it } from 'vitest';

import {
  LEGACY_SETTINGS_GROUPS,
  SETTINGS_GROUPS_BY_SCOPE,
  errorGroupOf,
  errorsByGroup,
  groupOf,
  settingsLocationOf,
} from '../src/shared/lib/nav/settingsGroups.ts';
import { formatRoute, parseRoute } from '../src/shared/lib/nav/route.ts';

describe('groups of settings', () => {
  it('has the groups of both tabs', () => {
    expect(SETTINGS_GROUPS_BY_SCOPE.global).toEqual([
      'general',
      'agents',
      'delivery',
      'queue',
      'runtimes',
      'swarm',
      'observers',
      'projects',
      'system',
    ]);
    expect(SETTINGS_GROUPS_BY_SCOPE.project).toEqual([
      'general',
      'agents',
      'delivery',
      'queue',
      'swarm',
      'tags',
    ]);
  });

  it('puts every field to the enlarged group of its section', () => {
    expect(groupOf('max')).toBe('general');
    expect(groupOf('workspace_dir')).toBe('general');
    expect(groupOf('outside_changes')).toBe('general');
    expect(groupOf('workspace.base')).toBe('general');
    expect(groupOf('naming.runtime')).toBe('general');
    expect(groupOf('delivery.mode')).toBe('delivery');
    expect(groupOf('defaults.allow_commands')).toBe('agents');
    expect(groupOf('claude.mcp')).toBe('agents');
    expect(groupOf('runtimes.claude.env')).toBe('runtimes');
    expect(groupOf('queue.scope')).toBe('queue');
    expect(groupOf('swarm.queue.max')).toBe('queue');
    expect(groupOf('web.port')).toBe('system');
    expect(groupOf('swarm.web.port')).toBe('system');
  });

  it('puts an error to the group of its section, the others to general', () => {
    expect(errorGroupOf('swarm.naming.runtime')).toBe('general');
    expect(errorGroupOf('swarm.claude.mcp')).toBe('agents');
    expect(errorGroupOf('swarm.specialists.coder.model')).toBe('general');
    expect(errorGroupOf('swarm')).toBe('general');
    const grouped = errorsByGroup([
      { path: 'swarm.delivery.mode', message: 'a' },
      { path: 'swarm.specialists.coder.name', message: 'b' },
      { path: 'swarm.delivery.keep', message: 'c' },
    ]);
    expect([...grouped.keys()]).toEqual(['delivery', 'general']);
    expect(grouped.get('delivery')).toHaveLength(2);
  });

  it('opens general for a group the tab does not have, and leads old keys to their place', () => {
    expect(settingsLocationOf('project', 'queue')).toEqual({ scope: 'project', group: 'queue' });
    expect(settingsLocationOf('global', 'queue')).toEqual({ scope: 'global', group: 'queue' });
    expect(settingsLocationOf('project', 'nope')).toEqual({ scope: 'project', group: 'general' });
    expect(settingsLocationOf('global', 'specialist-tags')).toEqual({
      scope: 'global',
      group: 'general',
    });
    expect(settingsLocationOf('project', 'specialist-tags')).toEqual({
      scope: 'project',
      group: 'general',
    });
    expect(settingsLocationOf(null, null)).toEqual({ scope: 'global', group: 'general' });
    expect(settingsLocationOf('nowhere', null)).toEqual({ scope: 'global', group: 'general' });
    for (const [key, place] of Object.entries(LEGACY_SETTINGS_GROUPS)) {
      expect(settingsLocationOf(key, null)).toEqual(place);
    }
    expect(settingsLocationOf('naming', null)).toEqual({ scope: 'global', group: 'general' });
    expect(settingsLocationOf('claude', null)).toEqual({ scope: 'global', group: 'agents' });
    expect(settingsLocationOf('web', null)).toEqual({ scope: 'global', group: 'system' });
    expect(settingsLocationOf('queue', null)).toEqual({ scope: 'project', group: 'queue' });
    expect(settingsLocationOf('tags', null)).toEqual({ scope: 'project', group: 'tags' });
    expect(settingsLocationOf('global', 'tags')).toEqual({ scope: 'project', group: 'tags' });
    expect(settingsLocationOf('project', 'tags')).toEqual({ scope: 'project', group: 'tags' });
  });
});

describe('settings addresses', () => {
  const route = (run: string | null, group: string | null) => ({
    view: 'settings' as const,
    run,
    group,
    step: null,
    tab: null,
  });

  it('reads and writes #settings/<tab>/<group>', () => {
    expect(parseRoute('#settings/project/queue')).toEqual(route('queue', 'project'));
    expect(parseRoute('#settings/global/delivery')).toEqual(route('delivery', 'global'));
    expect(parseRoute('#settings')).toEqual(route('general', 'global'));
    expect(parseRoute('#settings/project/nope')).toEqual(route('general', 'project'));
    expect(formatRoute(route('system', 'global'))).toBe('#settings/global/system');
    expect(formatRoute(route(null, null))).toBe('#settings/global/general');
  });

  it('leads the addresses of earlier versions to the new groups', () => {
    expect(parseRoute('#settings/queue')).toEqual(route('queue', 'project'));
    expect(parseRoute('#settings/delivery')).toEqual(route('delivery', 'global'));
    expect(parseRoute('#settings/web')).toEqual(route('system', 'global'));
    expect(parseRoute('#settings/nowhere')).toEqual(route('general', 'global'));
    expect(formatRoute(route('queue', null))).toBe('#settings/project/queue');
    expect(parseRoute('#settings/tags')).toEqual(route('tags', 'project'));
    expect(parseRoute('#settings/global/tags')).toEqual(route('tags', 'project'));
    expect(formatRoute(route('tags', 'project'))).toBe('#settings/project/tags');
  });

  const swarm = (
    scope: string,
    tab: string,
    step: string | null = null,
    section: string | null = null,
  ) => ({
    view: 'settings' as const,
    run: 'swarm',
    group: scope,
    step,
    tab,
    section,
    variant: null,
  });

  it('reads and writes the addresses of the group «Swarm» with the tab of the window and the entry', () => {
    expect(parseRoute('#settings/global/swarm/providers/anthropic')).toEqual(
      swarm('global', 'providers', 'anthropic'),
    );
    expect(parseRoute('#settings/project/swarm/chains/new')).toEqual(
      swarm('project', 'chains', 'new'),
    );
    expect(parseRoute('#settings/project/swarm/pipelines/actions/commit')).toEqual(
      swarm('project', 'pipelines', 'commit', 'actions'),
    );
    expect(formatRoute(swarm('project', 'pipelines', 'commit', 'actions'))).toBe(
      '#settings/project/swarm/pipelines/actions/commit',
    );
    expect(formatRoute(swarm('global', 'providers', 'anthropic'))).toBe(
      '#settings/global/swarm/providers/anthropic',
    );
    expect(formatRoute(swarm('project', 'roles'))).toBe('#settings/project/swarm/roles');
  });

  it('opens «Specialists» for a missing or unknown tab of the window', () => {
    expect(parseRoute('#settings/global/swarm')).toEqual(swarm('global', 'specialists'));
    expect(parseRoute('#settings/global/swarm/nope')).toEqual(swarm('global', 'specialists'));
    expect(formatRoute(parseRoute('#settings/global/swarm/nope'))).toBe(
      '#settings/global/swarm/specialists',
    );
  });

  it('leads the former addresses of the groups of the shared tab to the tabs of the window', () => {
    expect(parseRoute('#settings/global/specialists/qa')).toEqual(
      swarm('global', 'specialists', 'qa'),
    );
    expect(parseRoute('#settings/global/specialists/new').step).toBe('new');
    expect(parseRoute('#settings/global/specialists').step).toBeNull();
    expect(parseRoute('#settings/global/pipelines/quick')).toEqual(
      swarm('global', 'pipelines', 'quick'),
    );
    expect(parseRoute('#settings/global/chains/default')).toEqual(
      swarm('global', 'chains', 'default'),
    );
    expect(parseRoute('#settings/chains')).toEqual(swarm('global', 'chains'));
    expect(formatRoute(parseRoute('#settings/global/pipelines/quick'))).toBe(
      '#settings/global/swarm/pipelines/quick',
    );
    // the project tab has no such groups
    expect(parseRoute('#settings/project/specialists')).toEqual(route('general', 'project'));
    expect(parseRoute('#settings/project/pipelines')).toEqual(route('general', 'project'));
    expect(parseRoute('#settings/global/delivery/qa').step).toBeNull();
    expect(formatRoute({ ...route('delivery', 'global'), step: 'qa' })).toBe(
      '#settings/global/delivery',
    );
  });

  it('sends the former general settings address to the settings page', () => {
    expect(parseRoute('#specialists/_settings')).toEqual(route('general', 'global'));
    expect(parseRoute('#specialists/coder').view).toBe('specialists');
  });
});

describe('addresses of the group Runtimes', () => {
  it('opens a runtime by its key and the overview without one', () => {
    expect(parseRoute('#settings/global/runtimes/codex')).toEqual({
      view: 'settings',
      run: 'runtimes',
      group: 'global',
      step: 'codex',
      tab: null,
    });
    expect(formatRoute(parseRoute('#settings/global/runtimes/codex'))).toBe(
      '#settings/global/runtimes/codex',
    );
    expect(formatRoute(parseRoute('#settings/global/runtimes'))).toBe('#settings/global/runtimes');
    expect(parseRoute('#settings/project/runtimes')).toMatchObject({
      run: 'general',
      group: 'project',
      step: null,
    });
  });
});

describe('addresses of the group Projects', () => {
  it('opens a project by its slug, the new form, and General on the project tab', () => {
    expect(parseRoute('#settings/global/projects/shop')).toEqual({
      view: 'settings',
      run: 'projects',
      group: 'global',
      step: 'shop',
      tab: null,
    });
    expect(formatRoute(parseRoute('#settings/global/projects/new'))).toBe(
      '#settings/global/projects/new',
    );
    expect(formatRoute(parseRoute('#settings/global/projects'))).toBe('#settings/global/projects');
    expect(parseRoute('#settings/project/projects')).toMatchObject({
      run: 'general',
      group: 'project',
      step: null,
    });
  });
});
