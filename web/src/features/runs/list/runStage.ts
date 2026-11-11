import type { RunView, SystemStepKind } from '../../../shared/api/types.ts';

/** The current stages of a run: the first one to show, how many more there are, all of them. */
export interface RunStage {
  first: string;
  rest: number;
  all: string[];
}

const STAGE_STATES: string[] = ['active', 'needs_human', 'repair', 'paused', 'frozen'];
const PAST = ['merging', 'merged', 'conflict', 'failed', 'cancelled', 'done'];

interface Candidate {
  status: string;
  name: string | null;
}

function priority(status: string, state: string): number {
  if (status === 'needs_human' && state === 'needs_human') return 0;
  return status === 'running' ? 1 : 2;
}

/** Names of the stages a run is on, the most important first; empty outside the live states. */
export function runStages(run: RunView, systemName: (kind: SystemStepKind) => string): string[] {
  if (!STAGE_STATES.includes(run.state)) return [];
  const system = run.system ?? [];
  const named = (row: (typeof system)[number]): Candidate => ({
    status: row.status,
    name: row.kind === 'action' ? row.title : systemName(row.kind),
  });
  const candidates: Candidate[] = [
    ...system.filter((row) => row.kind === 'split').map(named),
    ...run.groups.map((group) => ({ status: group.status, name: group.stepName ?? group.step })),
    ...system.filter((row) => row.kind !== 'split').map(named),
  ].filter((entry) => !PAST.includes(entry.status) && entry.name);
  const ordered = candidates
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        priority(a.entry.status, run.state) - priority(b.entry.status, run.state) ||
        a.index - b.index,
    );
  return [...new Set(ordered.map(({ entry }) => entry.name as string))];
}

/** The stage to show in the status badge of a run, or null when there is none. */
export function runStage(
  run: RunView,
  systemName: (kind: SystemStepKind) => string,
): RunStage | null {
  const all = runStages(run, systemName);
  const [first] = all;
  return first === undefined ? null : { first, rest: all.length - 1, all };
}
