import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { FieldError } from '../../../../shared/api/types.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { Input } from '../../../../shared/ui/forms/input.tsx';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';
import { Switch } from '../../../../shared/ui/forms/switch.tsx';
import { Textarea } from '../../../../shared/ui/forms/textarea.tsx';
import { Card } from '../../../../shared/ui/layout/card.tsx';
import { fieldLabel, type StepDraft } from './draft.ts';
import { NONE, SpecialistSelect } from './SpecialistSelect.tsx';

export interface StepCardProps {
  step: StepDraft;
  index: number;
  /** Every step of the draft: the return can go only to an earlier one. */
  steps: StepDraft[];
  /** The ids the steps get on save. */
  ids: string[];
  slugs: string[];
  disabled: boolean;
  errors: FieldError[];
  onPatch: (patch: Partial<StepDraft>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

/** The choice of the step to return to and the number of rounds. */
function ReturnChoice({
  step,
  steps,
  ids,
  disabled,
  onPatch,
}: Pick<StepCardProps, 'step' | 'steps' | 'ids' | 'disabled' | 'onPatch'>) {
  const { t } = useTranslation();
  const earlier = steps.slice(0, steps.indexOf(step));
  const target = steps.find((candidate) => candidate.key === step.gotoKey);
  const options = target && !earlier.includes(target) ? [...earlier, target] : earlier;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>{t('pipelines.onReject')}</span>
      <Select
        value={step.gotoKey === null ? (step.gotoRaw ? '!raw' : NONE) : String(step.gotoKey)}
        disabled={disabled}
        onValueChange={(next) =>
          onPatch({ gotoKey: next === NONE ? null : Number(next), gotoRaw: '' })
        }
      >
        <SelectTrigger aria-label={t('pipelines.gotoStep')} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('pipelines.none')}</SelectItem>
          {step.gotoKey === null && step.gotoRaw ? (
            <SelectItem value="!raw" disabled>
              {t('pipelines.missingStep', { id: step.gotoRaw })}
            </SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.key} value={String(option.key)}>
              {ids[steps.indexOf(option)] ||
                t('pipelines.step', { index: steps.indexOf(option) + 1 })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {step.gotoKey !== null || step.gotoRaw ? (
        <label className="flex items-center gap-2">
          {t('pipelines.rounds')}
          <Input
            aria-label={t('pipelines.roundsLabel')}
            type="text"
            className="w-16"
            value={step.maxRounds}
            disabled={disabled}
            onChange={(event) => onPatch({ maxRounds: event.target.value })}
          />
        </label>
      ) : null}
    </div>
  );
}

/** One step: its specialist, the move and remove buttons, the return, the prompt and the review. */
export function StepCard(props: StepCardProps) {
  const { step, index, steps, slugs, disabled, errors, onPatch } = props;
  const { t } = useTranslation();
  return (
    <li aria-label={t('pipelines.step', { index: index + 1 })}>
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <SpecialistSelect
            current={step.specialist}
            slugs={slugs}
            label={t('pipelines.stepSpecialist')}
            disabled={disabled}
            onChange={(next) => onPatch({ specialist: next })}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('pipelines.up')}
            disabled={disabled || index === 0}
            onClick={() => props.onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('pipelines.down')}
            disabled={disabled || index === steps.length - 1}
            onClick={() => props.onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('pipelines.removeStep')}
            disabled={disabled}
            onClick={props.onRemove}
          >
            <Trash2 />
          </Button>
        </div>
        <ReturnChoice {...props} />
        <Textarea
          aria-label={t('pipelines.stepPrompt')}
          rows={2}
          value={step.additionalPrompt}
          disabled={disabled}
          placeholder={t('pipelines.stepPrompt')}
          onChange={(event) => onPatch({ additionalPrompt: event.target.value })}
        />
        <div className="flex items-center gap-2">
          <Switch
            id={`review-${step.key}`}
            checked={step.humanReview}
            disabled={disabled}
            onCheckedChange={(humanReview) => onPatch({ humanReview })}
          />
          <Label htmlFor={`review-${step.key}`}>{t('pipelines.humanReview')}</Label>
        </div>
        {errors.map((error) => (
          <p
            className="text-sm text-destructive"
            role="alert"
            key={`${error.path}:${error.message}`}
          >
            {fieldLabel(error.path)}: {error.message}
          </p>
        ))}
      </Card>
    </li>
  );
}
