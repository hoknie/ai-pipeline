/**
 * Pipeline entries of the list: actions and built-in (system) stages. The shapes are declared
 * here, structurally, so the panel compiles whatever the protocol types look like.
 */
import type { EntryLevel, StageSection } from '../../api/types.ts';

/** Points of the pipeline where a pipeline (or `swarm.stages`) runs actions. */
export const ACTION_POINTS = [
  'before_split',
  'after_split',
  'before_delivery',
  'after_delivery',
] as const;
export type ActionPoint = (typeof ACTION_POINTS)[number];

/** The section of the stages of each point; the same table the engine uses for its stages. */
export const POINT_SECTION: Record<ActionPoint, StageSection> = {
  before_split: 'prepare',
  after_split: 'prepare',
  before_delivery: 'delivery',
  after_delivery: 'finish',
};

/** Points that only exist in a pipeline with a split. */
export const SPLIT_POINTS: readonly ActionPoint[] = ['before_split', 'after_split'];

export type ActionKind = 'command' | 'specialist';

export interface ActionSource {
  file: string;
  revision: string;
  raw: Record<string, unknown>;
}

/** An action of the catalog (`actions/<id>.yaml`) with the files of each level. */
export interface ActionEntry {
  id: string;
  level: EntryLevel;
  file: string;
  revision: string | null;
  raw: Record<string, unknown>;
  sources: { project?: ActionSource; global?: ActionSource };
}

/** Where an action (or specialist) is named: a point of `swarm.stages` or of a pipeline. */
export interface ActionReference {
  pipeline?: string;
  point?: string;
  action?: string;
  step?: string;
  split?: boolean;
  field?: string;
  repository?: string;
}

export const SYSTEM_KINDS = ['split', 'message', 'resolve', 'delivery'] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];

export const isSystemKind = (value: string | null): value is SystemKind =>
  SYSTEM_KINDS.some((kind) => kind === value);

export interface SystemStageSetting {
  path: string;
  value: unknown;
  level: 'default' | 'global' | 'project';
}

export interface SystemStageEntry {
  kind: SystemKind;
  name: string;
  /** The built-in task; null for a stage without one. */
  task: string | null;
  settings: SystemStageSetting[];
}

export interface SystemStagesResponse {
  repository: string;
  stages: SystemStageEntry[];
  errors: { file?: string; path: string; message: string }[];
}

/** The settings that hold the additional prompt of a built-in stage. */
export const PROMPT_PATHS: Partial<Record<SystemKind, string>> = {
  message: 'delivery.message_prompt',
  resolve: 'delivery.resolver_prompt',
};

/** The actions of a configuration view; an older protocol has none. */
export function actionsOf(view: object): ActionEntry[] {
  const actions = (view as { actions?: unknown }).actions;
  return Array.isArray(actions) ? (actions as ActionEntry[]) : [];
}

/** Whether the action runs a command (rather than a specialist). */
export const isCommandAction = (raw: Record<string, unknown>): boolean =>
  raw.specialist === undefined;

/** `action:<point>:<id>` of a stage of the pipeline. */
export function parseActionStage(id: string): { point: ActionPoint; action: string } | null {
  const match = /^action:([a-z_]+):(.+)$/.exec(id);
  const point = ACTION_POINTS.find((candidate) => candidate === match?.[1]);
  return match && point ? { point, action: match[2] as string } : null;
}

/** The action ids of each point that the stages of a topology list, in order. */
export function pointsOfStages(
  stages: readonly { id: string; kind: string }[] | undefined,
): Record<ActionPoint, string[]> {
  const points: Record<ActionPoint, string[]> = {
    before_split: [],
    after_split: [],
    before_delivery: [],
    after_delivery: [],
  };
  for (const stage of stages ?? []) {
    if (stage.kind !== 'action') continue;
    const parsed = parseActionStage(stage.id);
    if (parsed) points[parsed.point].push(parsed.action);
  }
  return points;
}

/** The action lists a pipeline file names itself; a point that is not a list of strings is absent. */
export function ownPointsOf(raw: unknown): Partial<Record<ActionPoint, string[]>> {
  const stages = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: Partial<Record<ActionPoint, string[]>> = {};
  for (const point of ACTION_POINTS) {
    const list = stages[point];
    if (Array.isArray(list)) {
      result[point] = list.filter((item): item is string => typeof item === 'string');
    }
  }
  return result;
}
