import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse, FieldError } from '../../../../shared/api/types.ts';
import type { ActionPoint } from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import type { PipelineStage } from '../../../../shared/lib/pipeline/pipelineStages.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { formatRoute } from '../../../../shared/lib/nav/route.ts';
import { splitTargets, specialistSlugs } from '../FormTab.tsx';
import { PointsInput } from '../points/PointsInput.tsx';
import { stepOfError, type Draft } from '../steps/draft.ts';
import type { CanvasEdge, CanvasNode } from '../steps/draftGraph.ts';
import {
  moveStep,
  patchStep,
  removeStep,
  setReturn,
  withPoint,
  withSplit,
} from '../steps/draftOps.ts';
import { SplitFieldset } from '../steps/SplitFieldset.tsx';
import { StepFields } from '../steps/StepCard.tsx';
import { errorsOfStep, type Selection } from './canvasModel.ts';
import { NodeName } from './CanvasNode.tsx';
import { StageInspector } from './StageInspector.tsx';

export interface InspectorProps {
  selection: Selection | null;
  draft: Draft;
  onDraft: (change: (current: Draft) => Draft) => void;
  view: ConfigEditorResponse;
  pipelineId: string;
  ids: string[];
  errors: FieldError[];
  sharedOnly: boolean;
  disabled: boolean;
  previewStages: readonly PipelineStage[] | null | undefined;
  /** The nodes and the connections of the canvas, for the inspector of a connection. */
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  onResetAnchors: (edge: CanvasEdge) => void;
}

function StepInspector({
  selection,
  draft,
  onDraft,
  ...rest
}: InspectorProps & { selection: { kind: 'step'; key: number } }) {
  const { t } = useTranslation();
  const index = draft.steps.findIndex((step) => step.key === selection.key);
  const step = draft.steps[index];
  if (!step) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {t('pipelines.canvasStepId')}:{' '}
        <code data-testid="inspector-step-id">{rest.ids[index] || '—'}</code>
      </p>
      <StepFields
        step={step}
        index={index}
        steps={draft.steps}
        ids={rest.ids}
        slugs={specialistSlugs(rest.view, rest.sharedOnly)}
        disabled={rest.disabled}
        errors={errorsOfStep(rest.errors, rest.pipelineId, draft, index)}
        onPatch={(patch) => onDraft((current) => patchStep(current, step.key, patch))}
        onMove={(delta) => onDraft((current) => moveStep(current, step.key, index + delta))}
        onRemove={() => onDraft((current) => removeStep(current, step.key))}
      />
    </div>
  );
}

function SplitInspector({
  draft,
  onDraft,
  view,
  pipelineId,
  errors,
  sharedOnly,
  disabled,
}: InspectorProps) {
  const { targets, nameOf } = splitTargets(
    view,
    pipelineId,
    sharedOnly,
    draft.split?.pipeline ?? '',
  );
  return (
    <SplitFieldset
      split={draft.split}
      slugs={specialistSlugs(view, sharedOnly)}
      targets={targets}
      nameOf={nameOf}
      disabled={disabled}
      errors={errors.filter(
        (error) => stepOfError(error.path, pipelineId, draft.split !== null).split,
      )}
      onSplit={(patch) => onDraft((current) => withSplit(current, patch))}
    />
  );
}

/** A connection: where it goes from and to, the buttons that give its ends back and remove a return. */
function EdgeInspector({
  edgeId,
  returnKey,
  nodes,
  edges,
  disabled,
  onDraft,
  onResetAnchors,
}: InspectorProps & { edgeId: string; returnKey: number | null }) {
  const { t } = useTranslation();
  const edge = edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return null;
  const dataOf = (id: string) => nodes.find((node) => node.id === id)?.data;
  const from = dataOf(edge.source);
  const to = dataOf(edge.target);
  return (
    <div className="flex flex-col gap-2" data-testid="inspector-edge">
      <p className="text-sm font-medium">{t('pipelines.canvasEdge')}</p>
      <p className="flex flex-wrap items-center gap-1 text-sm">
        {from ? <NodeName data={from} /> : edge.source}
        <span aria-hidden>→</span>
        {to ? <NodeName data={to} /> : edge.target}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onResetAnchors(edge)}>
          {t('pipelines.canvasResetAnchors')}
        </Button>
        {returnKey !== null ? (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => onDraft((current) => setReturn(current, returnKey, null))}
          >
            {t('pipelines.canvasRemoveReturn')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The properties of the chosen node: the same fields the form has. */
export function CanvasInspector(props: InspectorProps) {
  const { t } = useTranslation();
  const { selection, draft, onDraft, view, sharedOnly, disabled } = props;
  // the split and the points have a frame of their own; the others stand on a card
  let framed = false;
  let body;
  if (!selection)
    body = <p className="text-sm text-muted-foreground">{t('pipelines.canvasHint')}</p>;
  else if (selection.kind === 'step') body = <StepInspector {...props} selection={selection} />;
  else if (selection.kind === 'split') {
    framed = true;
    body = <SplitInspector {...props} />;
  } else if (selection.kind === 'point') {
    framed = true;
    const point: ActionPoint = selection.point;
    body = (
      <PointsInput
        view={view}
        only={point}
        hasSplit={draft.split !== null}
        stages={draft.stages}
        previewStages={props.previewStages}
        sharedOnly={sharedOnly}
        disabled={disabled}
        onPoint={(next, list) => onDraft((current) => withPoint(current, next, list))}
      />
    );
  } else if (selection.kind === 'stage') {
    body = <StageInspector id={selection.id} stages={props.previewStages ?? null} />;
  } else if (selection.kind === 'return') {
    body = (
      <EdgeInspector {...props} edgeId={`return:${selection.key}`} returnKey={selection.key} />
    );
  } else if (selection.kind === 'edge') {
    body = <EdgeInspector {...props} edgeId={selection.id} returnKey={null} />;
  } else {
    const pipeline = draft.split?.pipeline ?? '';
    body = (
      <p className="text-sm">
        {t('pipelines.canvasFollowNote', { pipeline })}{' '}
        <a
          className="underline"
          href={formatRoute({
            view: 'pipelines',
            run: pipeline,
            group: null,
            step: null,
            tab: null,
          })}
        >
          {pipeline}
        </a>
      </p>
    );
  }
  return (
    <aside
      className="flex min-w-0 flex-col gap-2"
      aria-label={t('pipelines.canvasInspector')}
      data-canvas-inspector=""
    >
      {framed ? body : <div className="rounded-lg border bg-card p-3">{body}</div>}
    </aside>
  );
}
