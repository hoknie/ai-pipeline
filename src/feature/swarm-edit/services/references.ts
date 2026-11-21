import { basename } from 'node:path';
import { assembleLevel, readLevel } from '../../swarm-config/services/index.ts';
import { type ConfigPaths, isMapping, mergeConfigs } from '../../swarm-config/types/index.ts';
import { type EntryReference } from '../types/editor.ts';
import { field } from '../types/setting-fields.ts';

/** Overrides of the variants of a pipeline that `matches`: of its split, then of its steps. */
function variantReferences(
  id: string,
  pipeline: Record<string, unknown>,
  matches: (override: Record<string, unknown>) => boolean,
): EntryReference[] {
  const references: EntryReference[] = [];
  const variants = isMapping(pipeline.variants) ? pipeline.variants : {};
  for (const [variant, body] of Object.entries(variants)) {
    if (!isMapping(body)) continue;
    if (isMapping(body.split) && matches(body.split)) {
      references.push({ pipeline: id, variant, split: true });
    }
    const steps = isMapping(body.steps) ? body.steps : {};
    for (const [step, override] of Object.entries(steps)) {
      if (isMapping(override) && matches(override))
        references.push({ pipeline: id, variant, step });
    }
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that names the specialist. */
export function specialistReferences(tree: unknown, slug: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  for (const [id, pipeline] of Object.entries(pipelines)) {
    if (!isMapping(pipeline)) continue;
    if (isMapping(pipeline.split) && pipeline.split.specialist === slug) {
      references.push({ pipeline: id, split: true });
    }
    references.push(...variantReferences(id, pipeline, (override) => override.specialist === slug));
    const steps = Array.isArray(pipeline.steps) ? pipeline.steps : [];
    for (const [index, step] of steps.entries()) {
      if (isMapping(step) && step.specialist === slug) {
        references.push({
          pipeline: id,
          step: typeof step.id === 'string' ? step.id : String(index),
        });
      }
    }
  }
  const actions = isMapping(swarm.actions) ? swarm.actions : {};
  for (const [id, action] of Object.entries(actions)) {
    if (isMapping(action) && action.specialist === slug) references.push({ action: id });
  }
  const delivery = isMapping(swarm.delivery) ? swarm.delivery : {};
  for (const field of ['resolver', 'message_specialist']) {
    if (delivery[field] === slug) references.push({ field: `delivery.${field}` });
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that delegates to the pipeline through `split.pipeline`. */
export function pipelineReferences(tree: unknown, id: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  const references: EntryReference[] = [];
  for (const [name, pipeline] of Object.entries(pipelines)) {
    if (isMapping(pipeline) && isMapping(pipeline.split) && pipeline.split.pipeline === id) {
      references.push({ pipeline: name, split: true });
    }
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that names the action in a pipeline point. */
export function actionReferences(tree: unknown, id: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  const scan = (stages: unknown, owner: Partial<EntryReference>): void => {
    if (!isMapping(stages)) return;
    for (const [point, ids] of Object.entries(stages)) {
      if (Array.isArray(ids) && ids.includes(id)) references.push({ ...owner, point });
    }
  };
  scan(swarm.stages, {});
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  for (const [name, pipeline] of Object.entries(pipelines)) {
    if (isMapping(pipeline)) scan(pipeline.stages, { pipeline: name });
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that names the chain in a specialist's `runtime_chain`. */
export function chainReferences(tree: unknown, slug: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  const specialists = isMapping(swarm.specialists) ? swarm.specialists : {};
  for (const [name, specialist] of Object.entries(specialists)) {
    if (isMapping(specialist) && specialist.runtime_chain === slug) {
      references.push({ specialist: name });
    }
  }
  const pipelines = isMapping(swarm.pipelines) ? swarm.pipelines : {};
  for (const [id, pipeline] of Object.entries(pipelines)) {
    if (!isMapping(pipeline)) continue;
    references.push(
      ...variantReferences(id, pipeline, (override) => override.runtime_chain === slug),
    );
  }
  return references;
}

/** Everything in a merged `{ swarm }` tree that names the provider in an item of a chain. */
export function providerReferences(tree: unknown, slug: string): EntryReference[] {
  const swarm = isMapping(tree) && isMapping(tree.swarm) ? tree.swarm : {};
  const references: EntryReference[] = [];
  if (swarm.default_provider === slug) references.push({ setting: 'default_provider' });
  const chains = isMapping(swarm.chains) ? swarm.chains : {};
  for (const [name, chain] of Object.entries(chains)) {
    const items = isMapping(chain) && Array.isArray(chain.runtimes) ? chain.runtimes : [];
    items.forEach((item, index) => {
      if (isMapping(item) && item.provider === slug) references.push({ chain: name, item: index });
    });
  }
  return references;
}

export function stemOf(path: string): string {
  return basename(path).replace(/\.ya?ml$/, '');
}

/**
 * References from chain items to a shared provider in the repositories that do not define a project
 * provider of that slug. Works on files that read as YAML, so a broken configuration still counts.
 */
export function sharedProviderUsage(
  global: ConfigPaths,
  projects: readonly { repository: string; paths: ConfigPaths }[],
  slug: string,
): EntryReference[] {
  const globalLevel = assembleLevel(readLevel(global.global, { tolerant: true }));
  const references: EntryReference[] = [];
  for (const { repository, paths } of projects) {
    const level = assembleLevel(readLevel(paths.project, { tolerant: true }));
    const swarm = isMapping(level.tree) && isMapping(level.tree.swarm) ? level.tree.swarm : {};
    if (isMapping(swarm.providers) && Object.hasOwn(swarm.providers, slug)) continue;
    for (const reference of providerReferences(mergeConfigs(globalLevel.tree, level.tree), slug)) {
      references.push({ ...reference, repository });
    }
  }
  return references;
}
