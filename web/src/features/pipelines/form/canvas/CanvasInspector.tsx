import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse, FieldError } from '../../../../shared/api/types.ts';
import type { ActionPoint } from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { formatRoute } from '../../../../shared/lib/nav/route.ts';
import { splitTargets, specialistSlugs } from '../FormTab.tsx';
import { PointsInput } from '../points/PointsInput.tsx';
import { stepOfError, type Draft } from '../steps/draft.ts';
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
  previewStages: { id: string; kind: string }[] | null | undefined;
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

/** The properties of the chosen node: the same fields the form has. */
export function CanvasInspector(props: InspectorProps) {
  const { t } = useTranslation();
  const { selection, draft, onDraft, view, sharedOnly, disabled } = props;
  let body;
  if (!selection)
    body = <p className="text-sm text-muted-foreground">{t('pipelines.canvasHint')}</p>;
  else if (selection.kind === 'step') body = <StepInspector {...props} selection={selection} />;
  else if (selection.kind === 'split') body = <SplitInspector {...props} />;
  else if (selection.kind === 'point') {
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
  } else if (selection.kind === 'return') {
    const key = selection.key;
    body = (
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => onDraft((current) => setReturn(current, key, null))}
      >
        {t('pipelines.canvasRemoveReturn')}
      </Button>
    );
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
      {body}
    </aside>
  );
}
