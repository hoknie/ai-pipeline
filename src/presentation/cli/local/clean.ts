import { openMaintenance } from '../../../app/maintenance.ts';
import {
  type RunState,
  deliveryBranch,
  groupRef,
  isRunFinished,
} from '../../../feature/runs/types/index.ts';
import {
  cleanRun as cleanWorkspace,
  hasRunLeftovers,
  runWorktreeRoot,
  workspaceRoot,
  type CleanPlan,
} from '../../../platform/git/index.ts';
import { plainStyle, table, type Style } from '../../format/index.ts';
import { runTitle } from '../../../feature/runs/types/index.ts';

import type { Context } from '../context.ts';
import { notFound } from '../../../platform/errors/index.ts';

export interface CleanableRun {
  id: string;
  title: string;
  finishedAt: number;
  repository: string;
}

function planFor(state: RunState, all: boolean): CleanPlan {
  const runId = state.run.id;
  const workspace = workspaceRoot(state.run.repository, state.run.config.workspaceDir);
  return {
    repository: state.run.repository,
    root: runWorktreeRoot(workspace, runId),
    runBranch: state.run.refStyle === 'refs' ? deliveryBranch(state.run) : state.run.branch,
    groupBranches:
      state.run.refStyle === 'refs'
        ? []
        : state.groups.map((group) => groupRef(state.run, group.slug)),
    refPrefix: state.run.refStyle === 'refs' ? `refs/aip/${runId}/` : null,
    all,
    active: !isRunFinished(state),
  };
}

export async function cleanRun(ctx: Context, runId: string, all: boolean): Promise<string[]> {
  const maintenance = openMaintenance(ctx.stateDirectory);
  try {
    const state = maintenance.loadRun(runId);
    if (!state) throw notFound('cli.clean', `unknown run \`${runId}\``);
    return await cleanWorkspace(planFor(state, all));
  } finally {
    maintenance.close();
  }
}

/** Finished runs that still have something to clean, the latest finished first. */
export async function cleanableRuns(ctx: Context): Promise<CleanableRun[]> {
  const maintenance = openMaintenance(ctx.stateDirectory);
  try {
    const result: CleanableRun[] = [];
    for (const state of maintenance.finishedRuns()) {
      if (state.run.finishedAt === null) continue;
      if (!(await hasRunLeftovers(planFor(state, false)))) continue;
      result.push({
        id: state.run.id,
        title: runTitle(state),
        finishedAt: state.run.finishedAt,
        repository: state.run.repository,
      });
    }
    return result;
  } finally {
    maintenance.close();
  }
}

function minute(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCleanable(runs: CleanableRun[], style: Style = plainStyle): string {
  if (runs.length === 0) return 'No finished runs to clean.';
  const rows = [
    ['RUN', 'FINISHED', 'TITLE'],
    ...runs.map((run) => [style.accent(run.id), minute(run.finishedAt), run.title]),
  ];
  return [table(rows, style), '', style.muted('To clean one: aip run clean <run-id>')].join('\n');
}
