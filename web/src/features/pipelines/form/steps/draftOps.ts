import type { ActionPoint } from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import { withoutStep } from '../variants/variantDraft.ts';
import { newStepDraft, type Draft, type SplitDraft, type StepDraft } from './draft.ts';

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** The draft with a new step at `index` (clamped to the list); `key` is the key of the step. */
export function insertStep(
  draft: Draft,
  index: number,
  step: StepDraft = newStepDraft(),
): { draft: Draft; key: number } {
  const at = clamp(index, 0, draft.steps.length);
  const steps = [...draft.steps];
  steps.splice(at, 0, step);
  return { draft: { ...draft, steps }, key: step.key };
}

/**
 * The draft without the step. Steps that returned to it lose the return and its rounds;
 * a goto that named no step of the draft stays as it was.
 */
export function removeStep(draft: Draft, key: number): Draft {
  if (!draft.steps.some((step) => step.key === key)) return draft;
  return {
    ...draft,
    steps: draft.steps
      .filter((step) => step.key !== key)
      .map((step) =>
        step.gotoKey === key ? { ...step, gotoKey: null, gotoRaw: '', maxRounds: '' } : step,
      ),
    variants: withoutStep(draft.variants, key),
  };
}

/** The steps with the element at `index` moved by `delta` places; the same list at the edge. */
export function movedBy(steps: StepDraft[], index: number, delta: number): StepDraft[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const copy = [...steps];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved as StepDraft);
  return copy;
}

/** The draft with the step moved to the place `toIndex` of the list. */
export function moveStep(draft: Draft, key: number, toIndex: number): Draft {
  const from = draft.steps.findIndex((step) => step.key === key);
  if (from < 0) return draft;
  const to = clamp(toIndex, 0, draft.steps.length - 1);
  if (to === from) return draft;
  return { ...draft, steps: movedBy(draft.steps, from, to - from) };
}

/** The draft with the fields of one step changed. */
export function patchStep(draft: Draft, key: number, patch: Partial<StepDraft>): Draft {
  return {
    ...draft,
    steps: draft.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)),
  };
}

/** Whether `source` may return to `target`: only to an earlier step. */
export function canReturn(draft: Draft, source: number, target: number): boolean {
  const from = draft.steps.findIndex((step) => step.key === source);
  const to = draft.steps.findIndex((step) => step.key === target);
  return from >= 0 && to >= 0 && to < from;
}

/** The draft where `source` returns to `target`; `null` removes the return. */
export function setReturn(draft: Draft, source: number, target: number | null): Draft {
  if (target === null) {
    const step = draft.steps.find((candidate) => candidate.key === source);
    if (!step || (step.gotoKey === null && step.gotoRaw === '')) return draft;
    return patchStep(draft, source, { gotoKey: null, gotoRaw: '', maxRounds: '' });
  }
  if (!canReturn(draft, source, target)) return draft;
  return patchStep(draft, source, { gotoKey: target, gotoRaw: '' });
}

export const STEP_NODE_PREFIX = 'step:';

/** The key of the step a node of the canvas stands for. */
export function stepKeyOfNode(id: string | null | undefined): number | null {
  if (!id?.startsWith(STEP_NODE_PREFIX)) return null;
  const key = Number(id.slice(STEP_NODE_PREFIX.length));
  return Number.isInteger(key) ? key : null;
}

/** A connection drawn between two nodes of the canvas becomes a return. */
export function connectReturn(
  draft: Draft,
  connection: { source: string | null; target: string | null },
): Draft {
  const source = stepKeyOfNode(connection.source);
  const target = stepKeyOfNode(connection.target);
  if (source === null || target === null) return draft;
  return setReturn(draft, source, target);
}

/** The draft with the split changed; `null` removes it. */
export function withSplit(current: Draft, patch: Partial<SplitDraft> | null): Draft {
  if (patch === null) return { ...current, split: null };
  const empty = { specialist: '', maxGroups: '', pipeline: '', additionalPrompt: '' };
  return { ...current, split: { ...empty, ...current.split, ...patch } };
}

/** The draft with the own list of a point changed; `null` gives the point back to the inherited one. */
export function withPoint(current: Draft, point: ActionPoint, list: string[] | null): Draft {
  const next = { ...current.stages };
  if (list === null) delete next[point];
  else next[point] = list;
  return { ...current, stages: next };
}
