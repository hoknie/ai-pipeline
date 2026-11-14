import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../../src/feature/swarm-config/services/validate.ts';
import { mergeConfigs } from '../../../src/feature/swarm-config/types/merge.ts';
import { withConfigDefaults } from '../../../src/feature/swarm-config/types/settings.ts';

describe('runtime settings', () => {
  it('defaults new and old snapshots to compatible settings', () => {
    const result = validateConfig({ swarm: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.opencode).toEqual({ mcp: 'inherit', overrides: {} });
    expect(result.config.agy).toEqual({ mcp: 'isolated', overrides: {} });
    const old = structuredClone(result.config);
    delete (old as Partial<typeof old>).opencode;
    delete (old as Partial<typeof old>).agy;
    delete (old.claude as Partial<typeof old.claude>).overrides;
    const restored = withConfigDefaults(old);
    expect(restored.opencode).toEqual({ mcp: 'inherit', overrides: {} });
    expect(restored.agy).toEqual({ mcp: 'isolated', overrides: {} });
    expect(restored.claude.overrides).toEqual({});
  });

  it('replaces project overrides rather than merging them', () => {
    const merged = mergeConfigs(
      { swarm: { claude: { overrides: { a: 1, b: 2 } }, agy: { mcp: 'inherit' } } },
      { swarm: { claude: { overrides: { a: 3 } }, agy: { mcp: 'isolated' } } },
    );
    const result = validateConfig(merged);
    expect(result.ok && result.config.claude.overrides).toEqual({ a: 3 });
    expect(result.ok && result.config.agy.mcp).toBe('isolated');
  });

  it.each([
    [{ opencode: { mcp: 'none' } }, 'swarm.opencode.mcp'],
    [{ agy: { extra: true } }, 'swarm.agy.extra'],
    [{ opencode: { overrides: ['a'] } }, 'swarm.opencode.overrides'],
    [
      { claude: { overrides: { permissions: { allow: ['Bash(rm:*)'] } } } },
      'swarm.claude.overrides.permissions',
    ],
    [{ claude: { overrides: { hooks: {} } } }, 'swarm.claude.overrides.hooks'],
    [
      { opencode: { overrides: { agent: { 'aip-coder': {} } } } },
      'swarm.opencode.overrides.agent.aip-coder',
    ],
    [{ opencode: { overrides: { mcp: { aip: {} } } } }, 'swarm.opencode.overrides.mcp.aip'],
  ])('rejects invalid or reserved settings at their path', (swarm, path) => {
    const result = validateConfig({ swarm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.path)).toContain(path);
  });
});
