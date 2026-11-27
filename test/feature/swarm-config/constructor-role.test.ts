import { expect, it } from 'vitest';
import { parseConfig } from '../../../src/feature/swarm-config/services/index.ts';
import { roleModelOf } from '../../../src/feature/swarm-config/types/index.ts';
import { emptyRoles } from '../../../src/feature/agents/types/providers/providers.ts';

const CONFIG = `swarm:
  roles:
    constructor: { name: Constructor }
  providers:
    example:
      name: Example
      access: [{ kind: cli, runtime: opencode, model_prefix: example }]
      models: { constructor: actual }
  chains:
    role:
      name: Role
      mode: on_error
      runtimes: [{ runtime: opencode, provider: example, model_role: constructor }]
`;

it('falls back to the actual provider model for the constructor role', () => {
  const config = parseConfig(CONFIG);
  const provider = config.providers[0]!;
  expect(roleModelOf(provider, provider.access[0]!, 'constructor')).toEqual({
    model: 'example/actual',
  });
  expect(config.chains[0]?.runtimes[0]?.model).toBe('example/actual');
});

it('validates the actual provider constructor model instead of an inherited access key', () => {
  expect(() => parseConfig(CONFIG.replace(', model_prefix: example', ''))).toThrow(
    'swarm.providers.example.models.constructor',
  );
});

it('reports the missing constructor model at model_role instead of inheriting Object.constructor', () => {
  expect(() =>
    parseConfig(CONFIG.replace('models: { constructor: actual }', 'models: {}')),
  ).toThrow('no model for role `constructor` at provider `example`');
  const provider = parseConfig(CONFIG).providers[0]!;
  provider.models = {};
  expect(roleModelOf(provider, provider.access[0]!, 'constructor')).toBeNull();
  expect(
    emptyRoles([{ slug: 'constructor', name: 'Constructor', level: 'project' }], provider),
  ).toEqual(['constructor']);
});

it('still prefers an own access constructor record', () => {
  const config = parseConfig(
    CONFIG.replace(
      'model_prefix: example',
      'model_prefix: example, models: { constructor: route }',
    ),
  );
  expect(config.chains[0]?.runtimes[0]?.model).toBe('example/route');
  config.providers[0]!.models = {};
  expect(emptyRoles(config.roles, config.providers[0]!)).toEqual([]);
});

it('preserves spaces in role model IDs just like fixed models', () => {
  const config = parseConfig(
    CONFIG.replace('runtime: opencode, model_prefix: example', 'runtime: claude')
      .replace('constructor: actual', 'constructor: " A "')
      .replace('runtime: opencode, provider:', 'runtime: claude, provider:'),
  );
  expect(config.chains[0]?.runtimes[0]?.model).toBe(' A ');
  expect(config.providers[0]?.models.constructor).toEqual({ model: ' A ' });
  const fixed = parseConfig(
    CONFIG.replace('runtime: opencode, model_prefix: example', 'runtime: claude')
      .replace('constructor: actual', 'constructor: " A "')
      .replace('runtime: opencode, provider:', 'runtime: claude, provider:')
      .replace('model_role: constructor', 'model: " A "'),
  );
  expect(fixed.chains[0]?.runtimes[0]?.model).toBe(' A ');
});
