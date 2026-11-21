import { openMaintenance } from '../../../app/maintenance.ts';
import { plainStyle, table, type Style } from '../../format/index.ts';
import { runTitle } from '../../../feature/runs/types/index.ts';

import type { Context } from '../context.ts';

export interface CleanableRun {
  id: string;
  title: string;
  finishedAt: number;
  repository: string;
}

/** Finished runs that still have something to clean, the latest finished first. */
export async function cleanableRuns(ctx: Context): Promise<CleanableRun[]> {
  const maintenance = openMaintenance(ctx.stateDirectory);
  try {
    const result: CleanableRun[] = [];
    const queued = maintenance.queuedRuns();
    for (const state of maintenance.finishedRuns()) {
      if (state.run.finishedAt === null || state.run.cleanedAt !== null) continue;
      if (queued.has(state.run.id)) continue;
      if (!(await maintenance.hasLeftovers(state))) continue;
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
