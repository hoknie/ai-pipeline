import { useTranslation } from 'react-i18next';

import type { FieldError } from '../../../../shared/api/types.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { movedBy, newStepDraft, stepOfError, type Draft, type StepDraft } from './draft.ts';
import { StepCard } from './StepCard.tsx';

/** The steps of the pipeline in order, and the button that adds one. */
export function StepsList({
  draft,
  ids,
  pipelineId,
  slugs,
  disabled,
  errors,
  onDraft,
}: {
  draft: Draft;
  ids: string[];
  pipelineId: string;
  slugs: string[];
  disabled: boolean;
  errors: FieldError[];
  onDraft: (change: (current: Draft) => Draft) => void;
}) {
  const { t } = useTranslation();
  const hasSplit = draft.split !== null;
  const patch = (key: number, change: Partial<StepDraft>) =>
    onDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.key === key ? { ...step, ...change } : step)),
    }));
  const remove = (step: StepDraft, index: number) =>
    onDraft((c) => ({
      ...c,
      steps: c.steps
        .filter((candidate) => candidate.key !== step.key)
        .map((candidate) =>
          candidate.gotoKey === step.key
            ? { ...candidate, gotoKey: null, gotoRaw: ids[index] ?? '' }
            : candidate,
        ),
    }));
  return (
    <>
      <ol className="flex flex-col gap-2" aria-label={t('pipelines.steps')}>
        {draft.steps.map((step, index) => (
          <StepCard
            key={step.key}
            step={step}
            index={index}
            steps={draft.steps}
            ids={ids}
            slugs={slugs}
            disabled={disabled}
            errors={errors.filter(
              (error) => stepOfError(error.path, pipelineId, hasSplit).step === index,
            )}
            onPatch={(change) => patch(step.key, change)}
            onMove={(delta) => onDraft((c) => ({ ...c, steps: movedBy(c.steps, index, delta) }))}
            onRemove={() => remove(step, index)}
          />
        ))}
      </ol>
      <div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onDraft((c) => ({ ...c, steps: [...c.steps, newStepDraft()] }))}
        >
          {t('pipelines.addStep')}
        </Button>
      </div>
    </>
  );
}
