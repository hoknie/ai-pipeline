import type { RunView, PipelineTopology } from '../../shared/api/types.ts';

/** A group of an active run, placed on a node of the pipeline graph. */
export interface LiveGroup {
  runId: string;
  runTitle: string;
  slug: string;
  title: string;
  status: string;
}

export interface Live {
  steps: Map<string, LiveGroup[]>;
  attempts: Map<string, number>;
  cost: Map<string, number>;
  inputTokens: Map<string, number>;
  outputTokens: Map<string, number>;
  merging: LiveGroup[];
  merged: LiveGroup[];
  splitting: LiveGroup[];
  /** Groups on steps the current configuration no longer has. */
  elsewhere: LiveGroup[];
  runs: number;
  /** Ids of the runs shown, to tell their load from the load of other runs. */
  runIds: string[];
}

/** Where the groups of the active runs of a pipeline are now. */
export function liveState(
  pipeline: PipelineTopology,
  runs: RunView[],
  repository: string | null,
): Live {
  const live: Live = {
    steps: new Map(),
    attempts: new Map(),
    cost: new Map(),
    inputTokens: new Map(),
    outputTokens: new Map(),
    merging: [],
    merged: [],
    splitting: [],
    elsewhere: [],
    runs: 0,
    runIds: [],
  };
  const known = new Set(pipeline.steps.map((step) => step.id));
  for (const run of runs) {
    if (run.finished || run.pipeline !== pipeline.id) continue;
    if (repository !== null && run.repository !== repository) continue;
    live.runs += 1;
    live.runIds.push(run.id);
    const place = (group: { slug: string; title: string; status: string }): LiveGroup => ({
      runId: run.id,
      runTitle: run.title,
      ...group,
    });
    if (run.split && run.split.status !== 'done') {
      live.splitting.push({
        runId: run.id,
        runTitle: run.title,
        slug: '_split',
        title: run.title,
        status: run.split.status,
      });
    }
    for (const step of run.topology?.steps ?? []) {
      const target = known.has(step.id) ? (live.steps.get(step.id) ?? []) : live.elsewhere;
      target.push(...step.groups.map(place));
      if (known.has(step.id)) {
        live.steps.set(step.id, target);
        live.attempts.set(step.id, (live.attempts.get(step.id) ?? 0) + step.attempts);
        if (step.usage?.costUsd != null) {
          live.cost.set(step.id, (live.cost.get(step.id) ?? 0) + step.usage.costUsd);
        }
        live.inputTokens.set(
          step.id,
          (live.inputTokens.get(step.id) ?? 0) + (step.usage?.inputTokens ?? 0),
        );
        live.outputTokens.set(
          step.id,
          (live.outputTokens.get(step.id) ?? 0) + (step.usage?.outputTokens ?? 0),
        );
      }
    }
    live.merging.push(...(run.topology?.merging ?? []).map(place));
    live.merged.push(...(run.topology?.merged ?? []).map(place));
  }
  return live;
}
