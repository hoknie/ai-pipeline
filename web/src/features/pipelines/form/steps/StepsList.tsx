import { useTranslation } from 'react-i18next';

import type { FieldError } from '../../../../shared/api/types.ts';
import type { SpecialistOption } from '../../../../shared/lib/specialistLabels.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { stepOfError, type Draft, type StepDraft } from './draft.ts';
import { insertStep, moveStep, patchStep, removeStep } from './draftOps.ts';
import { StepCard } from './StepCard.tsx';

/** The steps of the pipeline in order, and the button that adds one. */
export function StepsList({
  draft,
  ids,
  pipelineId,
  options,
  disabled,
  errors,
  onDraft,
}: {
  draft: Draft;
  ids: string[];
  pipelineId: string;
  options: SpecialistOption[];
  disabled: boolean;
  errors: FieldError[];
  onDraft: (change: (current: Draft) => Draft) => void;
}) {
  const { t } = useTranslation();
  const hasSplit = draft.split !== null;
  const patch = (key: number, change: Partial<StepDraft>) =>
    onDraft((current) => patchStep(current, key, change));
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
            options={options}
            disabled={disabled}
            errors={errors.filter(
              (error) => stepOfError(error.path, pipelineId, hasSplit).step === index,
            )}
            onPatch={(change) => patch(step.key, change)}
            onMove={(delta) => onDraft((c) => moveStep(c, step.key, index + delta))}
            onRemove={() => onDraft((c) => removeStep(c, step.key))}
          />
        ))}
      </ol>
      <div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => onDraft((c) => insertStep(c, c.steps.length).draft)}
        >
          {t('pipelines.addStep')}
        </Button>
      </div>
    </>
  );
}
