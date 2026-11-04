import type { Edge, Node } from '@xyflow/react';
import type { TFunction } from 'i18next';

import type { LoadEntry, MachineLoad } from '../specialistLoad.ts';
import type { RunView, WorkflowTopology } from '../types.ts';

/** A group of an active run, placed on a node of the workflow graph. */
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

/** Where the groups of the active runs of a workflow are now. */
export function liveState(
  workflow: WorkflowTopology,
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
  const known = new Set(workflow.steps.map((step) => step.id));
  for (const run of runs) {
    if (run.finished || run.workflow !== workflow.id) continue;
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

/** How busy the specialist of a node is on the whole machine. */
export interface Busy {
  /** Attempts of the specialist running now, in all runs. */
  running: number;
  /** Of them, those in runs this graph does not show. */
  elsewhere: number;
  /** The smallest limit; null when nothing limits the specialist. */
  max: number | null;
  full: boolean;
}

export interface StageData extends Record<string, unknown> {
  kind: 'split' | 'step' | 'merge' | 'delivery' | 'resolver';
  title: string;
  subtitle: string;
  detail: string | null;
  groups: LiveGroup[];
  attempts: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  active: boolean;
  /** Step id, for steps. */
  step: string | null;
  /** Slug of the specialist of the node; null for nodes without one. */
  specialist: string | null;
  busy: Busy | null;
}

export type StageNode = Node<StageData, 'stage'>;

const GAP = 210;
/** Height assumed for a node that has not been measured yet. */
export const FALLBACK_HEIGHT = 90;
/** Vertical gap between the delivery and the resolver. */
export const RESOLVER_GAP = 60;

export interface Size {
  width: number;
  height: number;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Nodes for React Flow: a node whose position, selection and data did not change keeps its
 * previous object; a changed one is new but carries the last measured size, so React Flow
 * does not hide it until it is measured again.
 */
export function stabilize(
  previous: readonly StageNode[],
  next: readonly StageNode[],
  sizes: ReadonlyMap<string, Size>,
  selected: string | null,
): StageNode[] {
  const before = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const isSelected = node.id === selected;
    const old = before.get(node.id);
    if (
      old &&
      old.position.x === node.position.x &&
      old.position.y === node.position.y &&
      Boolean(old.selected) === isSelected &&
      sameJson(old.data, node.data)
    ) {
      return old;
    }
    const size = sizes.get(node.id) ?? old?.measured;
    return { ...node, selected: isSelected, ...(size ? { measured: { ...size } } : {}) };
  });
}

export function stabilizeEdges(previous: readonly Edge[], next: readonly Edge[]): Edge[] {
  const before = new Map(previous.map((edge) => [edge.id, edge]));
  return next.map((edge) => {
    const old = before.get(edge.id);
    return old && sameJson(old, edge) ? old : edge;
  });
}

/** Entries of other runs that run on, or wait for, the specialist. */
export function otherUse(
  load: MachineLoad,
  live: Live,
  specialist: string,
): { running: LoadEntry[]; waiting: LoadEntry[] } {
  const own = new Set(live.runIds);
  const slug = load.get(specialist);
  return {
    running: (slug?.running ?? []).filter((entry) => !own.has(entry.runId)),
    waiting: (slug?.waiting ?? []).filter((entry) => !own.has(entry.runId)),
  };
}

function busyOf(
  workflow: WorkflowTopology,
  live: Live,
  load: MachineLoad,
  specialist: string,
): Busy {
  const slug = load.get(specialist);
  const limits = [slug?.max ?? null, workflow.limits?.[specialist] ?? null].filter(
    (limit): limit is number => limit !== null && limit > 0,
  );
  const max = limits.length > 0 ? Math.min(...limits) : null;
  const running = slug?.running.length ?? 0;
  return {
    running,
    elsewhere: otherUse(load, live, specialist).running.length,
    max,
    full: max !== null && running >= max,
  };
}

function active(groups: LiveGroup[]): boolean {
  return groups.some((group) => group.status === 'running' || group.status === 'merging');
}

/** Nodes left to right: split, steps, merge, delivery; the resolver under the delivery. */
export function layout(
  workflow: WorkflowTopology,
  live: Live,
  t: TFunction,
  sizes: ReadonlyMap<string, Size> = new Map(),
  load: MachineLoad = new Map(),
): { nodes: StageNode[]; edges: Edge[] } {
  const nodes: StageNode[] = [];
  const edges: Edge[] = [];
  let x = 0;
  const place = (id: string, data: StageData) => {
    nodes.push({ id, type: 'stage', position: { x, y: 0 }, data });
    const previous = nodes.at(-2);
    if (previous) {
      edges.push({
        id: `${previous.id}->${id}`,
        source: previous.id,
        target: id,
        sourceHandle: 'out',
        targetHandle: 'in',
        animated: data.active,
        className: 'edge-forward',
      });
    }
    x += GAP;
  };
  const empty = {
    attempts: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    step: null,
    specialist: null,
    busy: null,
  };
  if (workflow.split) {
    place('split', {
      kind: 'split',
      title: t('topology.split'),
      subtitle: workflow.split.specialist,
      detail: [
        t('topology.splitDetail', { n: workflow.split.maxGroups }),
        ...(workflow.split.workflow
          ? [t('topology.splitWorkflow', { id: workflow.split.workflow })]
          : []),
      ].join(' · '),
      groups: live.splitting,
      active: live.splitting.some((group) => group.status === 'running'),
      ...empty,
      specialist: workflow.split.specialist,
      busy: busyOf(workflow, live, load, workflow.split.specialist),
    });
  }
  for (const step of workflow.steps) {
    const groups = live.steps.get(step.id) ?? [];
    place(`step:${step.id}`, {
      kind: 'step',
      title: step.name,
      subtitle: step.specialist,
      detail: `${step.runtime}${step.model ? ` ${step.model}` : ''} · ${step.permissions}`,
      groups,
      attempts: live.attempts.get(step.id) ?? 0,
      costUsd: live.cost.get(step.id) ?? null,
      inputTokens: live.inputTokens.get(step.id) ?? 0,
      outputTokens: live.outputTokens.get(step.id) ?? 0,
      active: active(groups),
      step: step.id,
      specialist: step.specialist,
      busy: busyOf(workflow, live, load, step.specialist),
    });
  }
  place('merge', {
    kind: 'merge',
    title: t('topology.merge'),
    subtitle: t('topology.mergeSubtitle'),
    detail: null,
    groups: live.merging,
    active: active(live.merging),
    ...empty,
  });
  place('delivery', {
    kind: 'delivery',
    title: t('topology.deliveryNode'),
    subtitle: workflow.delivery.mode,
    detail: null,
    groups: live.merged,
    active: false,
    ...empty,
  });
  if (workflow.delivery.resolver) {
    const delivery = nodes.at(-1);
    const height = (id: string) => sizes.get(id)?.height ?? FALLBACK_HEIGHT;
    nodes.push({
      id: 'resolver',
      type: 'stage',
      position: {
        x: delivery?.position.x ?? 0,
        y: height('delivery') / 2 + RESOLVER_GAP + height('resolver') / 2,
      },
      data: {
        kind: 'resolver',
        title: t('topology.resolver'),
        subtitle: workflow.delivery.resolver,
        detail: null,
        groups: [],
        active: false,
        ...empty,
        specialist: workflow.delivery.resolver,
        busy: busyOf(workflow, live, load, workflow.delivery.resolver),
      },
    });
    edges.push({
      id: 'delivery->resolver',
      source: 'delivery',
      target: 'resolver',
      sourceHandle: 'down',
      targetHandle: 'up',
      label: t('topology.conflict'),
      className: 'edge-resolver',
    });
  }
  for (const step of workflow.steps) {
    if (!step.onReject) continue;
    edges.push({
      id: `reject:${step.id}->${step.onReject.goto}`,
      source: `step:${step.id}`,
      target: `step:${step.onReject.goto}`,
      sourceHandle: 'back-out',
      targetHandle: 'back-in',
      type: 'smoothstep',
      label: `≤ ${step.onReject.maxRounds}`,
      className: 'edge-reject',
    });
  }
  return { nodes, edges };
}
