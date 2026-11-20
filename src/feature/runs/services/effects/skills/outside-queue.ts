import type { Runtime } from '../../../../agents/types/index.ts';
import type { Specialist } from '../../../../swarm-config/types/index.ts';
import { findGroup, type RunState } from '../../../types/index.ts';

import type { AttemptKey, EffectDependencies } from '../context.ts';

import {
  heldPins,
  layOutSkills,
  NO_SKILLS,
  pinsEvent,
  planSkills,
  type AttemptSkills,
  type SkillsPlan,
} from './registry.ts';

/** Whether the attempt still waits to start: the run goes on and the attempt was not stopped. */
function waiting(
  dependencies: Pick<EffectDependencies, 'context'>,
  state: RunState,
  key: AttemptKey,
): boolean {
  if (dependencies.context.stopping) return false;
  const attempt = findGroup(state, key.group)?.attempts.find((one) => one.seq === key.seq);
  return attempt?.status === 'running';
}

/**
 * Fixes and lays out the registry skills of an attempt. The network of the registry runs outside
 * the serial queue; the attempt comes back into it, checks that it is still waiting, applies the
 * event and starts. A step that was cancelled meanwhile does not start.
 */
export async function startWithRegistrySkills(
  dependencies: Pick<EffectDependencies, 'context' | 'registrySkills'>,
  state: RunState,
  key: AttemptKey,
  plan: Extract<SkillsPlan, { kind: 'registry' }>,
  directory: string,
  begin: (skills: AttemptSkills) => Promise<void>,
  fail: (message: string) => Promise<void>,
): Promise<void> {
  const { context, registrySkills } = dependencies;
  try {
    const found =
      plan.missing.length > 0
        ? await registrySkills.pin(state.run.repository, plan.missing)
        : { pinned: [], problems: [] };
    const pins = await context.serial(async () => {
      if (!waiting(dependencies, state, key)) return null;
      const event = pinsEvent(found);
      if (event !== null) await context.apply(state, event);
      return heldPins(state, plan.wanted);
    });
    if (pins === null) return;
    const skills = await layOutSkills(
      registrySkills,
      state.run.repository,
      pins,
      directory,
      found.problems,
    );
    await context.serial(async () => {
      if (waiting(dependencies, state, key)) await begin(skills);
    });
  } catch (error) {
    await context
      .serial(async () => {
        if (waiting(dependencies, state, key)) await fail((error as Error).message);
      })
      .catch(() => undefined);
  }
}

/**
 * Starts an attempt with the skills its specialist needs: at once when there are none to fetch,
 * else through `startWithRegistrySkills` (the caller does not wait for the network).
 */
export async function startWithSkills(
  dependencies: Pick<EffectDependencies, 'context' | 'registrySkills'>,
  state: RunState,
  key: AttemptKey,
  specialist: Specialist,
  runtime: Pick<Runtime, 'name' | 'loadsExtraSkills'>,
  directory: string,
  begin: (skills: AttemptSkills) => Promise<void>,
  fail: (message: string) => Promise<void>,
): Promise<void> {
  const plan = planSkills(state, specialist, runtime);
  if (plan.kind === 'registry') {
    void startWithRegistrySkills(dependencies, state, key, plan, directory, begin, fail);
    return;
  }
  await begin(
    plan.kind === 'unsupported' ? { directory: null, warnings: plan.warnings } : NO_SKILLS,
  );
}
