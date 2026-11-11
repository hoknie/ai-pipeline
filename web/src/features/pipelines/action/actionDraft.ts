import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import {
  isCommandAction,
  type ActionKind,
  type ActionReference,
} from '../../../shared/lib/pipeline/pipelineEntries.ts';

export const FIELDS = [
  'name',
  'run',
  'specialist',
  'additional_prompt',
  'timeout',
  'on_failure',
] as const;
export type Field = (typeof FIELDS)[number];

/** The script of `run`: a string as it is, a list (an older file) as lines, nothing as empty. */
function scriptOf(run: unknown): string {
  return Array.isArray(run) ? run.map(text).join('\n') : text(run);
}

export interface ActionDraft {
  name: string;
  kind: ActionKind;
  /** The script of a command; may span lines. */
  script: string;
  /** Seconds as typed; empty: the default. */
  timeout: string;
  specialist: string;
  additionalPrompt: string;
  /** Empty: the default (`stop`). */
  onFailure: '' | 'stop' | 'continue';
}

export function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function draftOfAction(raw: Record<string, unknown>): ActionDraft {
  return {
    name: text(raw.name),
    kind: isCommandAction(raw) ? 'command' : 'specialist',
    script: scriptOf(raw.run),
    timeout: text(raw.timeout),
    specialist: text(raw.specialist),
    additionalPrompt: text(raw.additional_prompt),
    onFailure: raw.on_failure === 'stop' || raw.on_failure === 'continue' ? raw.on_failure : '',
  };
}

const asNumber = (value: string): number | string =>
  /^\d+$/.test(value.trim()) ? Number(value) : value.trim();

/** The file content of a draft: only the fields of the chosen type. */
export function valueOfAction(draft: ActionDraft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (draft.name.trim() !== '') value.name = draft.name.trim();
  if (draft.kind === 'command') {
    value.run = draft.script;
    if (draft.timeout.trim() !== '') value.timeout = asNumber(draft.timeout);
  } else {
    value.specialist = draft.specialist;
    if (draft.additionalPrompt !== '') value.additional_prompt = draft.additionalPrompt;
  }
  if (draft.onFailure !== '') value.on_failure = draft.onFailure;
  return value;
}

/** The field a path of the check points at: `swarm.actions.<id>.<field>`. */
export function fieldOf(path: string, id: string): Field | null {
  const prefix = `swarm.actions.${id}.`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).split(/[.[]/)[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** A place that names an action, as the text of a line. */
export function describeActionReference(
  reference: ActionReference,
  view: ConfigEditorResponse | null,
): string {
  const point = reference.point ?? '';
  const where = (() => {
    if (!reference.pipeline) return `swarm.stages.${point}`;
    const entry = reference.repository
      ? undefined
      : view?.pipelines.find((candidate) => candidate.id === reference.pipeline);
    const name = typeof entry?.raw.name === 'string' ? entry.raw.name : reference.pipeline;
    return `${name} → stages.${point}`;
  })();
  return reference.repository ? `${repositoryLabel(reference.repository)}: ${where}` : where;
}
