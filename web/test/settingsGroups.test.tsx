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
      'runtimes',
      'chains',
      'specialists',
      'pipelines',
      'observers',
      'system',
    ]);
    expect(SETTINGS_GROUPS_BY_SCOPE.project).toEqual([
      'general',
      'agents',
      'delivery',
      'queue',
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
    expect(settingsLocationOf('global', 'queue')).toEqual({ scope: 'global', group: 'general' });
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

  it('keeps the shared specialist in the address of its group only', () => {
    expect(parseRoute('#settings/global/specialists/qa')).toEqual({
      ...route('specialists', 'global'),
      step: 'qa',
    });
    expect(parseRoute('#settings/global/specialists/new').step).toBe('new');
    expect(parseRoute('#settings/global/specialists').step).toBeNull();
    expect(parseRoute('#settings/global/delivery/qa').step).toBeNull();
    // the project tab has no such group
    expect(parseRoute('#settings/project/specialists')).toEqual(route('general', 'project'));
    expect(formatRoute({ ...route('specialists', 'global'), step: 'qa' })).toBe(
      '#settings/global/specialists/qa',
    );
    expect(formatRoute(route('specialists', 'global'))).toBe('#settings/global/specialists');
    expect(formatRoute({ ...route('delivery', 'global'), step: 'qa' })).toBe(
      '#settings/global/delivery',
    );
  });

  it('keeps the shared pipeline in the address of its group only', () => {
    expect(parseRoute('#settings/global/pipelines/quick')).toEqual({
      ...route('pipelines', 'global'),
      step: 'quick',
    });
    expect(parseRoute('#settings/global/pipelines/new').step).toBe('new');
    expect(parseRoute('#settings/global/pipelines').step).toBeNull();
    expect(parseRoute('#settings/project/pipelines')).toEqual(route('general', 'project'));
    expect(formatRoute({ ...route('pipelines', 'global'), step: 'quick' })).toBe(
      '#settings/global/pipelines/quick',
    );
    expect(formatRoute(route('pipelines', 'global'))).toBe('#settings/global/pipelines');
  });

  it('sends the former general settings address to the settings page', () => {
    expect(parseRoute('#specialists/_settings')).toEqual(route('general', 'global'));
    expect(parseRoute('#specialists/coder').view).toBe('specialists');
  });
});
