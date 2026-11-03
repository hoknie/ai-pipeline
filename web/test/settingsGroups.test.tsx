import { describe, expect, it } from 'vitest';

import {
  SETTINGS_GROUPS,
  errorGroupOf,
  errorsByGroup,
  groupOf,
  settingsGroupOf,
} from '../src/settingsGroups.ts';
import { formatRoute, parseRoute } from '../src/route.ts';

describe('groups of settings', () => {
  it('has eleven groups with the settings sections first', () => {
    expect(SETTINGS_GROUPS).toEqual([
      'general',
      'defaults',
      'delivery',
      'workspace',
      'naming',
      'claude',
      'runtimes',
      'web',
      'queue',
      'tags',
      'system',
    ]);
  });

  it('puts the fields of the top level in general and the others in their section', () => {
    expect(groupOf('max')).toBe('general');
    expect(groupOf('workspace_dir')).toBe('general');
    expect(groupOf('outside_changes')).toBe('general');
    expect(groupOf('workspace.base')).toBe('workspace');
    expect(groupOf('delivery.mode')).toBe('delivery');
    expect(groupOf('defaults.allow_commands')).toBe('defaults');
    expect(groupOf('claude.edit_mode')).toBe('claude');
    expect(groupOf('runtimes.claude.env')).toBe('runtimes');
    expect(groupOf('web.port')).toBe('web');
  });

  it('puts an error to the group of its section, the others to general', () => {
    expect(errorGroupOf('swarm.naming.runtime')).toBe('naming');
    expect(errorGroupOf('swarm.specialists.coder.model')).toBe('general');
    expect(errorGroupOf('swarm.workflows.feature.steps[0]')).toBe('general');
    expect(errorGroupOf('swarm')).toBe('general');
    const grouped = errorsByGroup([
      { path: 'swarm.naming.runtime', message: 'a' },
      { path: 'swarm.specialists.coder.name', message: 'b' },
      { path: 'swarm.naming.model', message: 'c' },
    ]);
    expect([...grouped.keys()]).toEqual(['naming', 'general']);
    expect(grouped.get('naming')).toHaveLength(2);
  });

  it('opens general for an unknown or missing group', () => {
    expect(settingsGroupOf('queue')).toBe('queue');
    expect(settingsGroupOf('nowhere')).toBe('general');
    expect(settingsGroupOf(null)).toBe('general');
  });
});

describe('settings addresses', () => {
  const route = (run: string | null) => ({
    view: 'settings' as const,
    run,
    group: null,
    step: null,
  });

  it('reads and writes #settings/<group>', () => {
    expect(parseRoute('#settings/queue')).toEqual(route('queue'));
    expect(parseRoute('#settings')).toEqual(route('general'));
    expect(parseRoute('#settings/nowhere')).toEqual(route('general'));
    expect(formatRoute(route('system'))).toBe('#settings/system');
    expect(formatRoute(route(null))).toBe('#settings/general');
  });

  it('sends the former general settings address to the settings page', () => {
    expect(parseRoute('#specialists/_settings')).toEqual(route('general'));
    expect(parseRoute('#specialists/coder').view).toBe('specialists');
  });
});
