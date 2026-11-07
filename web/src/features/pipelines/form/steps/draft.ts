import {
  ACTION_POINTS,
  SPLIT_POINTS,
  ownPointsOf,
  type ActionPoint,
} from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import { stepIds } from '../../stepIds.ts';

export interface StepDraft {
  /** Stable while the step is renamed or moved, so React keeps the focus. */
  key: number;
  /** The id is the specialist's slug (with a suffix when repeated). */
  autoId: boolean;
  /** The own id from the file, kept as it is when `autoId` is false. */
  fixedId: string;
  specialist: string;
  /** The step to return to, by key, so a rename keeps the link. */
  gotoKey: number | null;
  /** A goto that names no step of the draft; sent as it is, the check reports it. */
  gotoRaw: string;
  maxRounds: string;
  additionalPrompt: string;
  humanReview: boolean;
}

export interface SplitDraft {
  specialist: string;
  maxGroups: string;
  /** Pipeline whose steps the groups follow; empty for the own steps. */
  pipeline: string;
  additionalPrompt: string;
}

export interface Draft {
  /** Display name; empty: the file has none. */
  name: string;
  /** Tags of the file being edited. */
  tags: string[];
  steps: StepDraft[];
  split: SplitDraft | null;
  /** Own action lists by point; a point that is absent follows `swarm.stages`. */
  stages: Partial<Record<ActionPoint, string[]>>;
}

let nextKey = 1;

/** A step the person just added: automatic id, no specialist. */
export function newStepDraft(): StepDraft {
  return {
    key: nextKey++,
    autoId: true,
    fixedId: '',
    specialist: '',
    gotoKey: null,
    gotoRaw: '',
    maxRounds: '',
    additionalPrompt: '',
    humanReview: false,
  };
}

export function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function draftOf(raw: Record<string, unknown>): Draft {
  const list = Array.isArray(raw.steps) ? raw.steps.map(record) : [];
  const steps: StepDraft[] = list.map((step) => {
    const onReject = record(step.on_reject);
    return {
      key: nextKey++,
      autoId: false,
      fixedId: text(step.id),
      specialist: text(step.specialist),
      gotoKey: null,
      gotoRaw: text(onReject.goto),
      maxRounds: text(onReject.max_rounds),
      additionalPrompt: text(step.additional_prompt),
      humanReview: step.human_review === true,
    };
  });
  const derived = stepIds(steps.map((step) => ({ ...step, autoId: true })));
  const original = steps.map((step) => step.fixedId);
  for (const [index, step] of steps.entries()) {
    if (original[index] === derived[index]) step.autoId = true;
  }
  // A step stays automatic only if the final ids give it exactly its id from the file;
  // returning a step to its own id can change the others, so repeat until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    const final = stepIds(steps);
    for (const [index, step] of steps.entries()) {
      if (step.autoId && final[index] !== original[index]) {
        step.autoId = false;
        changed = true;
      }
    }
  }
  for (const [index, step] of steps.entries()) {
    step.fixedId = step.autoId ? '' : (original[index] ?? '');
  }
  const ids = stepIds(steps);
  for (const step of steps) {
    const target = steps.find((_, index) => ids[index] === step.gotoRaw);
    if (target && step.gotoRaw !== '') {
      step.gotoKey = target.key;
      step.gotoRaw = '';
    }
  }
  const split = raw.split === undefined ? null : record(raw.split);
  return {
    name: text(raw.name),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    steps,
    stages: ownPointsOf(raw.stages),
    split: split
      ? {
          specialist: text(split.specialist),
          maxGroups: text(split.max_groups),
          pipeline: text(split.pipeline),
          additionalPrompt: text(split.additional_prompt),
        }
      : null,
  };
}

const asNumber = (value: string): number | string =>
  /^\d+$/.test(value.trim()) ? Number(value) : value.trim();

/** The file content of a draft; the key order of the existing file is kept by the writer. */
export function valueOf(draft: Draft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (draft.name.trim() !== '') value.name = draft.name.trim();
  const tags = draft.tags.map((tag) => tag.trim()).filter((tag) => tag !== '');
  if (tags.length > 0) value.tags = tags;
  if (draft.split) {
    const split: Record<string, unknown> = { specialist: draft.split.specialist };
    if (draft.split.maxGroups.trim() !== '') split.max_groups = asNumber(draft.split.maxGroups);
    if (draft.split.additionalPrompt !== '') split.additional_prompt = draft.split.additionalPrompt;
    if (draft.split.pipeline !== '') split.pipeline = draft.split.pipeline;
    value.split = split;
  }
  const stages: Record<string, string[]> = {};
  for (const point of ACTION_POINTS) {
    const list = draft.stages[point];
    // a pipeline without a split has no points around it
    if (list === undefined || (!draft.split && SPLIT_POINTS.includes(point))) continue;
    stages[point] = list;
  }
  if (Object.keys(stages).length > 0) value.stages = stages;
  if (draft.split?.pipeline) return value;
  const ids = stepIds(draft.steps);
  value.steps = draft.steps.map((step, index) => {
    const out: Record<string, unknown> = { id: ids[index], specialist: step.specialist };
    const target =
      step.gotoKey === null
        ? step.gotoRaw
        : (ids[draft.steps.findIndex((candidate) => candidate.key === step.gotoKey)] ?? '');
    if (target !== '') {
      const onReject: Record<string, unknown> = { goto: target };
      if (step.maxRounds.trim() !== '') onReject.max_rounds = asNumber(step.maxRounds);
      out.on_reject = onReject;
    }
    if (step.additionalPrompt !== '') out.additional_prompt = step.additionalPrompt;
    if (step.humanReview) out.human_review = true;
    return out;
  });
  return value;
}

export function stepOfError(
  path: string,
  id: string,
  hasSplit: boolean,
): { step: number | null; split: boolean } {
  const prefix = `swarm.pipelines.${id}.`;
  if (!path.startsWith(prefix)) return { step: null, split: false };
  const rest = path.slice(prefix.length);
  const step = /^steps\[(\d+)\]/.exec(rest);
  if (step) return { step: Number(step[1]), split: false };
  // Errors of the whole list of steps belong to the choice of group steps.
  if (rest === 'steps') return { step: null, split: hasSplit };
  return { step: null, split: rest === 'split' || rest.startsWith('split.') };
}

export function isNameError(path: string, id: string): boolean {
  return path === `swarm.pipelines.${id}.name`;
}

export function isTagsError(path: string, id: string): boolean {
  return path === `swarm.pipelines.${id}.tags`;
}

export function fieldLabel(path: string): string {
  const match = /steps\[\d+\]\.(.+)$|split\.(.+)$|\.(steps)$/.exec(path);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

export function movedBy(steps: StepDraft[], index: number, delta: number): StepDraft[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const copy = [...steps];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved as StepDraft);
  return copy;
}
