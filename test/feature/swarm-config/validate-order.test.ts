import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../../src/feature/swarm-config/services/index.ts';

/** One mistake in every section of `swarm`, listed in the order the sections are checked. */
const BROKEN = {
  extra: 1,
  swarm: {
    bogus: 1,
    max: 0,
    workspace_dir: '',
    workspace: { base: 'nowhere' },
    naming: { enabled: 'yes' },
    web: { port: 0 },
    runtimes: 3,
    outside_changes: 'sometimes',
    claude: { edit_mode: 'free' },
    delivery: { mode: 'teleport' },
    defaults: { runtime: 'nothing' },
    specialists: { worker: { runtime: 'nothing' } },
    actions: { build: { run: 3 } },
    stages: { bogus: [] },
    pipelines: { flow: { steps: 'none' } },
  },
};

describe('validateConfig order', () => {
  it('reports errors section by section in a fixed order', () => {
    const result = validateConfig(BROKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path)).toEqual([
      'extra',
      'swarm.bogus',
      'swarm.max',
      'swarm.workspace_dir',
      'swarm.workspace.base',
      'swarm.naming.enabled',
      'swarm.web.port',
      'swarm.runtimes',
      'swarm.outside_changes',
      'swarm.claude.edit_mode',
      'swarm.delivery.mode',
      'swarm.defaults.runtime',
      'swarm.specialists.worker.runtime',
      'swarm.specialists.worker.name',
      'swarm.actions.build.run',
      'swarm.stages.bogus',
      'swarm.pipelines.flow.steps',
    ]);
  });
});
