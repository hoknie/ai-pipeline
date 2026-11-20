import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/feature/swarm-config/services/index.ts';
import {
  ConfigLoadError,
  type ResolvedConfig,
  applyVariant,
  checkVariant,
  findPipeline,
  findSpecialist,
  groupPipeline,
  pipelineVariants,
  stepSpecialist,
  variantNameOf,
  variantSkip,
} from '../../../src/feature/swarm-config/types/index.ts';

const BASE = `swarm:
  chains:
    fallback:
      name: Fallback
      mode: on_error
      runtimes:
        - { runtime: claude, model: haiku }
  specialists:
    plan: { name: Plan }
    coder: { name: Coder, runtime: claude, model: sonnet }
    chained: { name: Chained, runtime_chain: fallback }
    reviewer: { name: Reviewer, permissions: read }
    reviewer-lite: { name: Lite, permissions: read, model: haiku }
  pipelines:
`;

/** The configuration with `pipelines` (indented by four spaces) appended to the base. */
function configOf(pipelines: string): ResolvedConfig {
  return parseConfig(`${BASE}${pipelines}`);
}

function errorsOf(pipelines: string): { path: string; message: string }[] {
  try {
    configOf(pipelines);
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid') {
      return error.detail.errors;
    }
    throw error;
  }
  throw new Error('expected a validation failure');
}

const TASK = `    task:
      split: { specialist: plan }
      steps:
        - { id: plan, specialist: plan }
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 }, additional_prompt: Look at tests }
        - { id: qa, specialist: reviewer }
`;

describe('variants in the file', () => {
  it('reads two variants and gives default first', () => {
    const config = configOf(`${TASK}      variants:
        light: { name: Light }
        strong: {}
`);
    expect(pipelineVariants(config, 'task').map((variant) => variant.id)).toEqual([
      'default',
      'light',
      'strong',
    ]);
    expect(variantNameOf(config, 'task', 'light')).toBe('Light');
    expect(variantNameOf(config, 'task', 'strong')).toBe('strong');
    expect(variantNameOf(config, 'task', 'gone')).toBe('gone');
  });

  it('leaves a pipeline without variants as it was', () => {
    const config = configOf(TASK);
    expect(findPipeline(config, 'task')).not.toHaveProperty('variants');
    expect(pipelineVariants(config, 'task')).toEqual([
      { id: 'default', name: 'default', skip: [] },
    ]);
  });

  it('rejects an id outside the slug pattern with its path', () => {
    expect(errorsOf(`${TASK}      variants:\n        Light_1: {}\n`)).toContainEqual({
      path: 'swarm.pipelines.task.variants.Light_1',
      message: expect.stringContaining('^[a-z][a-z0-9-]{0,31}$'),
    });
  });

  it('reserves default', () => {
    expect(
      errorsOf(`${TASK}      variants:\n        default: { skip: [qa] }\n`).map((e) => e.path),
    ).toContain('swarm.pipelines.task.variants.default');
  });

  it('rejects an empty name and an unknown key', () => {
    const paths = errorsOf(`${TASK}      variants:\n        light: { name: "  ", extra: 1 }\n`).map(
      (e) => e.path,
    );
    expect(paths).toContain('swarm.pipelines.task.variants.light.name');
    expect(paths).toContain('swarm.pipelines.task.variants.light.extra');
  });
});

describe('overrides', () => {
  it('names an unknown step with the list of steps', () => {
    const found = errorsOf(
      `${TASK}      variants:\n        light:\n          steps:\n            deploy: { model: haiku }\n`,
    ).find((e) => e.path === 'swarm.pipelines.task.variants.light.steps.deploy');
    expect(found?.message).toContain('plan, code, review, qa');
  });

  it('rejects split of a pipeline without split', () => {
    const text = `    flat:
      steps:
        - { id: code, specialist: coder }
      variants:
        light:
          split: { model: haiku }
`;
    expect(errorsOf(text).map((e) => e.path)).toContain(
      'swarm.pipelines.flat.variants.light.split',
    );
  });

  it('rejects steps and skip of a pipeline with split.pipeline', () => {
    const text = `${TASK}    epic:
      split: { specialist: plan, pipeline: task }
      variants:
        light:
          skip: [qa]
          steps: { code: { model: haiku } }
`;
    const paths = errorsOf(text).map((e) => e.path);
    expect(paths).toContain('swarm.pipelines.epic.variants.light.skip');
    expect(paths).toContain('swarm.pipelines.epic.variants.light.steps');
  });

  it('rejects an unknown specialist and an unknown chain', () => {
    const paths = errorsOf(
      `${TASK}      variants:\n        light:\n          steps:\n            code: { specialist: nobody }\n            review: { runtime_chain: nowhere }\n`,
    ).map((e) => e.path);
    expect(paths).toContain('swarm.pipelines.task.variants.light.steps.code.specialist');
    expect(paths).toContain('swarm.pipelines.task.variants.light.steps.review.runtime_chain');
  });

  it('rejects a chain together with a model', () => {
    expect(
      errorsOf(
        `${TASK}      variants:\n        strong:\n          steps:\n            code: { runtime_chain: fallback, model: opus }\n`,
      ),
    ).toContainEqual({
      path: 'swarm.pipelines.task.variants.strong.steps.code.model',
      message: 'cannot be combined with runtime_chain',
    });
  });

  it('rejects an OpenCode option for a Claude executor and a bad OpenCode model', () => {
    const paths = errorsOf(
      `${TASK}      variants:\n        light:\n          steps:\n            code: { reasoning_effort: high }\n            review: { runtime: opencode, model: gpt }\n`,
    ).map((e) => e.path);
    expect(paths).toContain('swarm.pipelines.task.variants.light.steps.code.reasoning_effort');
    expect(paths).toContain('swarm.pipelines.task.variants.light.steps.review.model');
  });

  it('accepts OpenCode options for an OpenCode executor', () => {
    const config = configOf(
      `${TASK}      variants:\n        open:\n          steps:\n            code: { runtime: opencode, model: openai/gpt-5, variant: fast, reasoning_effort: high }\n`,
    );
    const step = findPipeline(config, 'task')!.steps[1]!;
    expect(stepSpecialist(applyVariant(config, 'task', 'open'), step)).toMatchObject({
      runtime: 'claude',
    });
    const applied = findPipeline(applyVariant(config, 'task', 'open'), 'task')!.steps[1]!;
    expect(stepSpecialist(config, applied)).toMatchObject({
      runtime: 'opencode',
      model: 'openai/gpt-5',
      variant: 'fast',
      reasoningEffort: 'high',
    });
  });
});

describe('skip of a variant', () => {
  it('uses the messages of the skip of a task', () => {
    const skipErrors = (skip: string) =>
      errorsOf(`${TASK}      variants:\n        light: { skip: ${skip} }\n`).filter(
        (e) => e.path === 'swarm.pipelines.task.variants.light.skip',
      );
    expect(skipErrors('[deploy]')[0]?.message).toBe(
      'unknown step `deploy` in skip; steps: plan, code, review, qa',
    );
    expect(skipErrors('[plan, code, review, qa]')[0]?.message).toBe('skip leaves no steps');
    expect(skipErrors('[code]')[0]?.message).toBe('step `review` returns to skipped step `code`');
  });

  it('collapses repeats', () => {
    const config = configOf(`${TASK}      variants:\n        light: { skip: [qa, qa] }\n`);
    expect(variantSkip(config, 'task', 'light')).toEqual(['qa']);
  });
});

describe('the specialist of a step', () => {
  const config = configOf(`${TASK}      variants:
        light:
          steps:
            review: { specialist: reviewer-lite, additional_prompt: null }
        swap:
          steps:
            code: { runtime: opencode }
        model:
          steps:
            code: { model: opus }
        chain:
          steps:
            code: { runtime_chain: fallback }
`);
  const stepOf = (variant: string, id: string) => {
    const applied = applyVariant(config, 'task', variant);
    return [applied, findPipeline(applied, 'task')!.steps.find((step) => step.id === id)!] as const;
  };

  it('replaces the specialist and removes the additional prompt', () => {
    const [applied, review] = stepOf('light', 'review');
    expect(review.specialist).toBe('reviewer-lite');
    expect(review.additionalPrompt).toBeNull();
    expect(stepSpecialist(applied, review)?.model).toBe('haiku');
    expect(findPipeline(config, 'task')!.steps[2]!.additionalPrompt).toBe('Look at tests');
  });

  it('keeps the model of the specialist when only the options change, drops it on a new executor', () => {
    const [applied, code] = stepOf('swap', 'code');
    expect(stepSpecialist(applied, code)).toMatchObject({ runtime: 'opencode', model: null });
  });

  it('takes the model of the override with the runtime of the specialist', () => {
    const [applied, code] = stepOf('model', 'code');
    expect(stepSpecialist(applied, code)).toMatchObject({
      runtime: 'claude',
      model: 'opus',
      runtimeChain: null,
    });
  });

  it('replaces the chain of a specialist by a model, with the default runtime', () => {
    const swapped =
      parseConfig(`${BASE}${TASK.replace('specialist: coder', 'specialist: chained')}      variants:
        strong:
          steps:
            code: { model: opus }
`);
    const applied = applyVariant(swapped, 'task', 'strong');
    const code = findPipeline(applied, 'task')!.steps[1]!;
    expect(findSpecialist(swapped, 'chained')?.runtimeChain).toBe('fallback');
    expect(stepSpecialist(applied, code)).toMatchObject({
      runtime: 'claude',
      model: 'opus',
      runtimeChain: null,
    });
  });

  it('runs a step by the chain of the override', () => {
    const [applied, code] = stepOf('chain', 'code');
    expect(stepSpecialist(applied, code)).toMatchObject({ runtimeChain: 'fallback', model: null });
  });

  it('is the specialist itself without an override', () => {
    const [applied, plan] = stepOf('light', 'plan');
    expect(stepSpecialist(applied, plan)).toBe(findSpecialist(applied, 'plan'));
  });
});

describe('variants of a pipeline with split.pipeline', () => {
  const config = configOf(`${TASK.replace('      split: { specialist: plan }\n', '')}      variants:
        light:
          skip: [qa]
          steps: { code: { model: haiku } }
    epic:
      split: { specialist: plan, pipeline: task }
      variants:
        light:
          name: Epic light
          split: { model: haiku }
        strong:
          split: { model: opus }
`);

  it('lists the variants of both pipelines and takes the skip from the target', () => {
    expect(pipelineVariants(config, 'epic')).toEqual([
      { id: 'default', name: 'default', skip: [] },
      { id: 'light', name: 'Epic light', skip: ['qa'] },
      { id: 'strong', name: 'strong', skip: [] },
    ]);
  });

  it('applies the split override to the epic and the steps to the target', () => {
    const applied = applyVariant(config, 'epic', 'light');
    expect(findPipeline(applied, 'epic')!.split?.agent).toEqual({ model: 'haiku' });
    expect(groupPipeline(applied, findPipeline(applied, 'epic')!).steps[1]!.agent).toEqual({
      model: 'haiku',
    });
  });

  it('leaves the target as it is when it has no such variant', () => {
    const applied = applyVariant(config, 'epic', 'strong');
    expect(findPipeline(applied, 'epic')!.split?.agent).toEqual({ model: 'opus' });
    expect(findPipeline(applied, 'task')).toEqual(findPipeline(config, 'task'));
  });

  it('names the known variants in the error', () => {
    expect(checkVariant(config, 'epic', 'fast')).toBe(
      'unknown variant `fast` of pipeline `epic`; known: default, light, strong',
    );
    expect(checkVariant(config, 'epic', 'light')).toBeNull();
    expect(checkVariant(config, 'task', 'default')).toBeNull();
    expect(checkVariant(config, 'task', 'strong')).toMatch(/known: default, light$/);
  });
});
