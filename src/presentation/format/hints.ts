import type { Style } from './style.ts';
import type { RunView } from '../ipc/contract/index.ts';

export type HintAction =
  | { kind: 'answer' | 'retry'; runId: string; group: string }
  | { kind: 'apply'; runId: string }
  | { kind: 'queue_start'; repository: string };

/** The one place that spells the commands of next-action hints. */
export function hintCommand(action: HintAction): string {
  switch (action.kind) {
    case 'answer':
      return `aip group answer ${action.runId} ${action.group} "<answer>"`;
    case 'retry':
      return `aip group retry ${action.runId} ${action.group}`;
    case 'apply':
      return `aip run apply ${action.runId}`;
    case 'queue_start':
      return `aip queue start --repo ${action.repository}`;
  }
}

export function hintLine(action: HintAction, style: Style): string {
  return style.muted(`→ ${hintCommand(action)}`);
}

/** Hints for the next action of a run; empty without color. */
export function runHints(run: RunView, style: Style): string[] {
  if (!style.rich) return [];
  const actions: HintAction[] = [];
  for (const group of run.groups) {
    if (group.status === 'needs_human')
      actions.push({ kind: 'answer', runId: run.id, group: group.slug });
    else if (group.status === 'failed' || group.status === 'conflict')
      actions.push({ kind: 'retry', runId: run.id, group: group.slug });
  }
  const { merged, applied, inProgress } = run.delivery;
  if (!run.autoDeliver && merged > applied && !inProgress)
    actions.push({ kind: 'apply', runId: run.id });
  return actions.map((action) => hintLine(action, style));
}
