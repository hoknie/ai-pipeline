import { describe, expect, it } from 'vitest';

import { createAgentsServices } from '../../../src/feature/agents/services/index.ts';
import { createAgents as createServices } from '../../../src/app/agents.ts';

const createAgents = (environment: NodeJS.ProcessEnv) => createServices(environment).agents;
import { defaultRuntimes, RUNTIMES } from '../../../src/feature/swarm-config/types/index.ts';

const NEW = ['codex', 'kilo', 'cline', 'copilot'] as const;

describe('AgentsService with the four CLIs', () => {
  it.each(NEW)(
    'picks the executable of %s: AIP_<NAME>_BIN, then the command, then the name',
    (name) => {
      const bin = `AIP_${name.toUpperCase()}_BIN`;
      const settings = defaultRuntimes();
      expect(createAgents({}).runtimeFor(name, settings).executable).toBe(name);
      settings[name].command = `/opt/${name}`;
      expect(createAgents({}).runtimeFor(name, settings).executable).toBe(`/opt/${name}`);
      expect(createAgents({ [bin]: '/fake/bin' }).runtimeFor(name, settings).executable).toBe(
        '/fake/bin',
      );
      expect(createAgents({}).runtimeFor(name, settings).name).toBe(name);
    },
  );

  it('is off until enabled by the field or by AIP_<NAME>_BIN', () => {
    const settings = defaultRuntimes();
    for (const name of NEW) {
      expect(createAgents({}).isEnabled(name, settings)).toBe(false);
      expect(
        createAgents({ [`AIP_${name.toUpperCase()}_BIN`]: '/f' }).isEnabled(name, settings),
      ).toBe(true);
      settings[name].enabled = false;
      expect(
        createAgents({ [`AIP_${name.toUpperCase()}_BIN`]: '/f' }).isEnabled(name, settings),
      ).toBe(false);
    }
  });

  it('has a catalog and a models entry for every runtime, with no Claude catalog borrowed', async () => {
    const agents = createAgents({});
    const catalog = agents.catalog('/repo', '/home/none');
    expect(Object.keys(catalog)).toEqual([...RUNTIMES]);
    for (const name of NEW) expect(catalog[name].tools).toEqual([]);
    const settings = defaultRuntimes();
    for (const name of NEW) settings[name].enabled = true;
    const models = await agents.models('/repo', settings);
    expect(Object.keys(models)).toEqual([...RUNTIMES]);
    for (const name of NEW) expect(models[name]).toEqual({ models: [], error: null });
  });

  it('is built from a factory per runtime', () => {
    const made: string[] = [];
    const factory = (name: string) => () => {
      made.push(name);
      return createAgents({}).runtimeFor('codex');
    };
    const service = createAgentsServices({
      environment: {},
      factories: Object.fromEntries(RUNTIMES.map((name) => [name, factory(name)])) as never,
      naming: { parse: () => null },
      commands: () => Promise.resolve({ stdout: '' }),
    }).agents;
    service.runtimeFor('kilo');
    expect(made).toEqual(['kilo']);
  });
});
