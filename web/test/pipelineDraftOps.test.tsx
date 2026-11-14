import { describe, expect, it } from 'vitest';

import { draftOf, valueOf, type Draft } from '../src/features/pipelines/form/steps/draft.ts';
import { draftGraph, type GraphContext } from '../src/features/pipelines/form/steps/draftGraph.ts';
import {
  canReturn,
  connectReturn,
  insertStep,
  moveStep,
  patchStep,
  removeStep,
  setReturn,
  stepKeyOfNode,
  withPoint,
  withSplit,
} from '../src/features/pipelines/form/steps/draftOps.ts';
import { stepIds } from '../src/features/pipelines/stepIds.ts';
import { findPipeline } from '../../src/feature/swarm-config/types/index.ts';
import { parseConfig } from '../../src/feature/swarm-config/services/index.ts';
import { pipelineStages } from '../../src/feature/runs/types/index.ts';
import type { PipelineStage } from '../src/shared/lib/pipeline/pipelineStages.ts';
import { ACTION_POINTS, POINT_SECTION } from '../src/shared/lib/pipeline/pipelineEntries.ts';

const RAW = {
  steps: [
    { id: 'plan', specialist: 'plan' },
    { id: 'code', specialist: 'coder', on_reject: { goto: 'plan', max_rounds: 2 } },
    { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
  ],
};

const ids = (draft: Draft) => draft.steps.map((_, index) => stepIds(draft.steps)[index]);
const gotos = (draft: Draft) =>
  (valueOf(draft).steps as { id: string; on_reject?: { goto: string; max_rounds?: number } }[]).map(
    (step) => step.on_reject?.goto ?? null,
  );

describe('insertStep', () => {
  it('inserts at the start, in the middle and at the end', () => {
    const draft = draftOf(RAW);
    const first = insertStep(draft, 0);
    expect(first.draft.steps.map((step) => step.key)[0]).toBe(first.key);
    const middle = insertStep(draft, 1);
    expect(middle.draft.steps[1]?.key).toBe(middle.key);
    const last = insertStep(draft, 99);
    expect(last.draft.steps).toHaveLength(4);
    expect(last.draft.steps[3]?.key).toBe(last.key);
    expect(draft.steps).toHaveLength(3);
  });

  it('keeps the returns by key when automatic ids change', () => {
    const draft = draftOf({
      steps: [
        { id: 'writer', specialist: 'writer' },
        { id: 'writer-2', specialist: 'writer', on_reject: { goto: 'writer', max_rounds: 1 } },
      ],
    });
    const inserted = insertStep(draft, 0, {
      ...insertStep(draft, 0).draft.steps[0]!,
      specialist: 'writer',
    }).draft;
    // the new step takes the first automatic id; the older ones follow in order
    expect(ids(inserted)[0]).toBe('writer');
    const target = inserted.steps.find((step) => step.gotoKey !== null);
    expect(target?.gotoKey).toBe(draft.steps[0]?.key);
  });
});

describe('removeStep', () => {
  it('drops the returns to the step and their rounds, and keeps the others', () => {
    const draft = draftOf(RAW);
    const without = removeStep(draft, draft.steps[0]!.key);
    expect(without.steps.map((step) => step.specialist)).toEqual(['coder', 'reviewer']);
    expect(without.steps[0]).toMatchObject({ gotoKey: null, gotoRaw: '', maxRounds: '' });
    expect(gotos(without)).toEqual([null, 'code']);
    expect(valueOf(without).steps).toEqual([
      { id: 'code', specialist: 'coder' },
      { id: 'review', specialist: 'reviewer', on_reject: { goto: 'code', max_rounds: 3 } },
    ]);
  });

  it('leaves a goto that names no step as it was', () => {
    const draft = draftOf({
      steps: [
        { id: 'a', specialist: 'plan' },
        { id: 'b', specialist: 'coder', on_reject: { goto: 'gone', max_rounds: 2 } },
      ],
    });
    const without = removeStep(draft, draft.steps[0]!.key);
    expect(without.steps[0]).toMatchObject({ gotoRaw: 'gone', maxRounds: '2' });
  });

  it('returns the same draft for an unknown key', () => {
    const draft = draftOf(RAW);
    expect(removeStep(draft, -1)).toBe(draft);
  });

  it('changes the automatic ids but not the links', () => {
    const draft = draftOf({
      steps: [
        { id: 'plan', specialist: 'plan' },
        { id: 'plan-2', specialist: 'plan' },
        { id: 'code', specialist: 'coder', on_reject: { goto: 'plan-2' } },
      ],
    });
    const auto = {
      ...draft,
      steps: draft.steps.map((step) => ({ ...step, autoId: true, fixedId: '' })),
    };
    const without = removeStep(auto, auto.steps[0]!.key);
    expect(ids(without)).toEqual(['plan', 'coder']);
    expect(gotos(without)).toEqual([null, 'plan']);
  });
});

describe('moveStep', () => {
  it('moves a step to a place and clamps the place', () => {
    const draft = draftOf(RAW);
    const moved = moveStep(draft, draft.steps[0]!.key, 2);
    expect(moved.steps.map((step) => step.specialist)).toEqual(['coder', 'reviewer', 'plan']);
    expect(moveStep(draft, draft.steps[2]!.key, -5).steps[0]?.specialist).toBe('reviewer');
    expect(moveStep(draft, draft.steps[1]!.key, 1)).toBe(draft);
    expect(moveStep(draft, -1, 0)).toBe(draft);
  });
});

describe('returns', () => {
  it('goes only to an earlier step', () => {
    const draft = draftOf(RAW);
    const [a, b, c] = draft.steps.map((step) => step.key) as [number, number, number];
    expect(canReturn(draft, c, a)).toBe(true);
    expect(canReturn(draft, a, c)).toBe(false);
    expect(canReturn(draft, b, b)).toBe(false);
    expect(setReturn(draft, a, c)).toBe(draft);
    expect(setReturn(draft, b, b)).toBe(draft);
    const set = setReturn(draft, c, a);
    expect(set.steps[2]?.gotoKey).toBe(a);
    expect(set.steps[2]?.maxRounds).toBe('3');
  });

  it('removes a return with its rounds', () => {
    const draft = draftOf(RAW);
    const cleared = setReturn(draft, draft.steps[2]!.key, null);
    expect(cleared.steps[2]).toMatchObject({ gotoKey: null, gotoRaw: '', maxRounds: '' });
    expect(setReturn(cleared, draft.steps[2]!.key, null)).toBe(cleared);
  });

  it('reads the ids of the nodes of a connection', () => {
    const draft = draftOf({ steps: RAW.steps.map(({ id, specialist }) => ({ id, specialist })) });
    const [a, , c] = draft.steps.map((step) => step.key) as [number, number, number];
    expect(stepKeyOfNode(`step:${a}`)).toBe(a);
    expect(stepKeyOfNode('split')).toBeNull();
    expect(stepKeyOfNode('step:x')).toBeNull();
    const connected = connectReturn(draft, { source: `step:${c}`, target: `step:${a}` });
    expect(gotos(connected)).toEqual([null, null, 'plan']);
    expect(connectReturn(draft, { source: `step:${a}`, target: `step:${c}` })).toBe(draft);
    expect(connectReturn(draft, { source: 'split', target: `step:${c}` })).toBe(draft);
  });
});

describe('split and points', () => {
  it('turns the split on and off and keeps what was set', () => {
    const draft = draftOf(RAW);
    const on = withSplit(draft, { specialist: 'plan' });
    expect(on.split).toEqual({
      specialist: 'plan',
      maxGroups: '',
      pipeline: '',
      additionalPrompt: '',
    });
    expect(withSplit(on, { maxGroups: '3' }).split?.specialist).toBe('plan');
    expect(withSplit(on, null).split).toBeNull();
  });

  it('sets and drops the list of a point', () => {
    const draft = withPoint(draftOf(RAW), 'before_delivery', ['lint']);
    expect(draft.stages.before_delivery).toEqual(['lint']);
    expect(withPoint(draft, 'before_delivery', null).stages).toEqual({});
  });
});

describe('draftGraph', () => {
  const base = (over: Partial<GraphContext> = {}, draft = draftOf(RAW)): GraphContext => ({
    pipelineId: 'feature',
    ids: stepIds(draft.steps),
    follow: null,
    points: { before_split: [], after_split: [], before_delivery: ['lint'], after_delivery: null },
    stages: null,
    errors: [],
    editable: true,
    ...over,
  });
  const idsOf = (graph: ReturnType<typeof draftGraph>) => graph.nodes.map((node) => node.id);

  it('orders the stages without a split', () => {
    const draft = draftOf(RAW);
    const graph = draftGraph(draft, base());
    const keys = draft.steps.map((step) => `step:${step.key}`);
    expect(idsOf(graph)).toEqual([
      'start',
      ...keys,
      'point:before_delivery',
      'delivery',
      'point:after_delivery',
    ]);
    expect(graph.nodes[1]?.data).toMatchObject({ title: 'plan', subtitle: 'plan', kind: 'step' });
    expect(graph.nodes.find((n) => n.id === 'point:before_delivery')?.data.count).toBe(1);
    expect(graph.nodes.find((n) => n.id === 'point:after_delivery')?.data.count).toBeNull();
  });

  const stage = (
    id: string,
    kind: PipelineStage['kind'],
    over: Partial<PipelineStage> = {},
  ): PipelineStage => ({
    id,
    kind,
    section: 'delivery',
    name: id,
    performer: { type: 'system' },
    condition: null,
    status: null,
    group: null,
    ...over,
  });
  const scribe = { type: 'specialist', slug: 'scribe', name: 'scribe' } as const;
  const SYSTEM_STAGES = [
    stage('message', 'message', { performer: scribe, condition: 'delivery_commit' }),
    stage('delivery', 'delivery'),
    stage('resolve', 'resolve', { performer: scribe, condition: 'conflict' }),
    stage('cleanup', 'cleanup', { section: 'finish', condition: 'not_keep' }),
  ];

  it('adds the message, the resolver and the cleanup from the stages of the daemon', () => {
    const graph = draftGraph(draftOf(RAW), base({ stages: SYSTEM_STAGES }));
    expect(idsOf(graph).filter((id) => !id.startsWith('step:'))).toEqual([
      'start',
      'point:before_delivery',
      'message',
      'delivery',
      'point:after_delivery',
      'cleanup',
      'resolver',
    ]);
    const data = (id: string) => graph.nodes.find((n) => n.id === id)?.data;
    expect(data('message')).toMatchObject({ performer: scribe, condition: 'delivery_commit' });
    expect(data('message')?.link).toBe('#pipelines/system/message');
    expect(data('delivery')).toMatchObject({ performer: { type: 'system' }, condition: null });
    expect(data('cleanup')).toMatchObject({ section: 'finish', sectionStart: false });
    const conflict = graph.edges.find((edge) => edge.target === 'resolver');
    expect(conflict).toMatchObject({
      source: 'delivery',
      sourceHandle: 'down',
      targetHandle: 'up',
    });
    const below = graph.nodes.find((n) => n.id === 'resolver')?.position;
    expect(below?.x).toBe(graph.nodes.find((n) => n.id === 'delivery')?.position.x);
    expect(below?.y).toBeGreaterThan(0);
    expect(data('resolver')?.sectionStart).toBe(false);
    expect(graph.edges.some((edge) => edge.target === 'message')).toBe(true);
  });

  it('keeps only the merge and the delivery without stages of the daemon', () => {
    const graph = draftGraph(draftOf(RAW), base());
    expect(idsOf(graph)).not.toContain('message');
    expect(idsOf(graph)).not.toContain('resolver');
    expect(idsOf(graph)).not.toContain('cleanup');
    const delivery = graph.nodes.find((n) => n.id === 'delivery')?.data;
    expect(delivery).toMatchObject({
      performer: { type: 'system' },
      link: '#pipelines/system/delivery',
    });
  });

  it('marks the first node of each section', () => {
    const draft = withSplit(draftOf(RAW), { specialist: 'plan' });
    const graph = draftGraph(draft, base({}, draft));
    const starts = graph.nodes
      .filter((n) => n.data.sectionStart)
      .map((n) => [n.id.startsWith('step:') ? 'step' : n.id, n.data.section]);
    expect(starts).toEqual([
      ['point:before_split', 'prepare'],
      ['step', 'work'],
      ['merge', 'merge'],
      ['point:before_delivery', 'delivery'],
      ['point:after_delivery', 'finish'],
    ]);
  });

  it('puts the split, its points and the merge around the steps', () => {
    const draft = withSplit(draftOf(RAW), { specialist: 'plan' });
    const graph = draftGraph(draft, base({}, draft));
    expect(idsOf(graph).filter((id) => !id.startsWith('step:'))).toEqual([
      'start',
      'point:before_split',
      'split',
      'point:after_split',
      'merge',
      'point:before_delivery',
      'delivery',
      'point:after_delivery',
    ]);
  });

  it('draws a return with its rounds and a plus where a step may go', () => {
    const draft = draftOf(RAW);
    const graph = draftGraph(draft, base());
    const back = graph.edges.find((edge) => edge.id === `return:${draft.steps[1]!.key}`);
    expect(back).toMatchObject({
      source: `step:${draft.steps[1]!.key}`,
      target: `step:${draft.steps[0]!.key}`,
      label: '≤ 2',
    });
    const plus = graph.edges.filter((edge) => edge.type === 'add');
    expect(plus.map((edge) => edge.data?.index)).toEqual([0, 1, 2, 3]);
    expect(graph.nodes.every((node) => node.draggable)).toBe(true);
  });

  it('has no plus and no linking when only shown, and still lets the nodes be moved', () => {
    const graph = draftGraph(draftOf(RAW), base({ editable: false }));
    expect(graph.edges.filter((edge) => edge.type === 'add')).toHaveLength(0);
    expect(graph.nodes.every((node) => node.draggable)).toBe(true);
    expect(graph.nodes.some((node) => node.connectable)).toBe(false);
  });

  it('lets the steps be linked exactly when editable', () => {
    const steps = (editable: boolean) =>
      draftGraph(draftOf(RAW), base({ editable })).nodes.filter((n) => n.data.kind === 'step');
    expect(steps(true).every((node) => node.connectable === true)).toBe(true);
    expect(steps(false).every((node) => node.connectable === false)).toBe(true);
  });

  it('offers a plus in an empty pipeline', () => {
    const draft = draftOf({ steps: [] });
    const graph = draftGraph(draft, base({}, draft));
    expect(graph.edges.filter((edge) => edge.type === 'add').map((e) => e.data?.index)).toEqual([
      0,
    ]);
  });

  it('marks the node of a step and the split by the errors', () => {
    const draft = withSplit(draftOf(RAW), { specialist: 'plan' });
    const graph = draftGraph(
      draft,
      base(
        {
          errors: [
            { path: 'swarm.pipelines.feature.steps[1].specialist', message: 'unknown' },
            { path: 'swarm.pipelines.feature.split.specialist', message: 'bad' },
          ],
        },
        draft,
      ),
    );
    const marked = graph.nodes.filter((node) => node.data.error).map((node) => node.id);
    expect(marked.sort()).toEqual(['split', `step:${draft.steps[1]!.key}`].sort());
  });

  it('shows the steps of another pipeline locked, and no plus', () => {
    const draft = withSplit(draftOf(RAW), { specialist: 'plan', pipeline: 'epic' });
    const graph = draftGraph(
      draft,
      base(
        {
          follow: {
            pipeline: 'epic',
            steps: [
              { id: 'a', specialist: 'plan', gotoIndex: null, maxRounds: '' },
              { id: 'b', specialist: 'coder', gotoIndex: 0, maxRounds: '2' },
            ],
          },
        },
        draft,
      ),
    );
    const follow = graph.nodes.filter((node) => node.data.kind === 'follow');
    expect(follow.map((node) => node.id)).toEqual(['follow:0', 'follow:1']);
    expect(follow.every((node) => node.data.locked && node.draggable)).toBe(true);
    expect(graph.nodes.some((node) => node.data.kind === 'step')).toBe(false);
    expect(graph.edges.some((edge) => edge.type === 'add')).toBe(false);
    expect(graph.edges.find((edge) => edge.id === 'return:follow:1')?.label).toBe('≤ 2');
  });

  it('shows a node with an error when the target pipeline is missing', () => {
    const draft = withSplit(draftOf(RAW), { specialist: 'plan', pipeline: 'gone' });
    const graph = draftGraph(draft, base({ follow: { pipeline: 'gone', steps: null } }, draft));
    expect(graph.nodes.find((node) => node.id === 'follow:0')?.data).toMatchObject({
      error: true,
      locked: true,
      title: 'gone',
    });
  });
});

describe('POINT_SECTION', () => {
  it('matches the sections the engine gives the stages of each point', () => {
    const resolved = parseConfig(`swarm:
  max: 2
  specialists:
    coder: { name: Coder }
  actions:
    one: { run: "a" }
  stages:
    before_split: [one]
    after_split: [one]
    before_delivery: [one]
    after_delivery: [one]
  pipelines:
    feature:
      split: { specialist: coder, max_groups: 2 }
      steps:
        - { id: code, specialist: coder }
`);
    const pipeline = findPipeline(resolved, 'feature');
    if (!pipeline) throw new Error('no pipeline');
    const stages = pipelineStages(resolved, pipeline);
    for (const point of ACTION_POINTS) {
      const own = stages.filter((stage) => stage.id.startsWith(`action:${point}:`));
      expect(own).toHaveLength(1);
      expect(own[0]?.section).toBe(POINT_SECTION[point]);
    }
  });
});

describe('variants follow the steps', () => {
  const variantsOf = (draft: Draft) => valueOf(draft).variants;
  const twoCoders = {
    steps: [
      { id: 'coder', specialist: 'coder' },
      { id: 'coder-2', specialist: 'coder' },
    ],
    variants: { strong: { steps: { 'coder-2': { model: 'opus' } } } },
  };

  it('writes the override under the new id after the specialist of the step changes', () => {
    const draft = draftOf({
      steps: [{ id: 'coder', specialist: 'coder' }],
      variants: { strong: { steps: { coder: { model: 'opus' } } } },
    });
    const next = patchStep(draft, draft.steps[0]!.key, { specialist: 'writer' });
    expect(variantsOf(next)).toEqual({ strong: { steps: { writer: { model: 'opus' } } } });
  });

  it('keeps the override on the same step when two steps of a specialist swap', () => {
    const draft = draftOf(twoCoders);
    const next = moveStep(draft, draft.steps[1]!.key, 0);
    expect(variantsOf(next)).toEqual({ strong: { steps: { coder: { model: 'opus' } } } });
  });

  it('keeps the override of the second step when the first of two coders is removed', () => {
    const draft = draftOf(twoCoders);
    const next = removeStep(draft, draft.steps[0]!.key);
    expect(variantsOf(next)).toEqual({ strong: { steps: { coder: { model: 'opus' } } } });
  });

  it('drops the skip and the override of a removed step from every variant', () => {
    const draft = draftOf({
      steps: [
        { id: 'code', specialist: 'coder' },
        { id: 'review', specialist: 'reviewer' },
      ],
      variants: {
        light: { skip: ['review'] },
        deep: { steps: { review: { model: 'opus' }, code: { model: 'sonnet' } } },
      },
    });
    const next = removeStep(draft, draft.steps[1]!.key);
    expect(variantsOf(next)).toEqual({
      light: {},
      deep: { steps: { code: { model: 'sonnet' } } },
    });
  });
});
