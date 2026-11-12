import { useTranslation } from 'react-i18next';

import type { FieldError } from '../../../../shared/api/types.ts';
import type { SpecialistOption } from '../../../../shared/lib/specialistLabels.ts';
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
import { fieldLabel, type SplitDraft } from './draft.ts';
import { NONE, SpecialistSelect } from './SpecialistSelect.tsx';

function SplitDetails({
  split,
  options,
  targets,
  nameOf,
  disabled,
  errors,
  onSplit,
}: {
  split: SplitDraft;
  options: SpecialistOption[];
  targets: string[];
  nameOf: (pipeline: string) => string;
  disabled: boolean;
  errors: FieldError[];
  onSplit: (patch: Partial<SplitDraft> | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>{t('pipelines.splitSpecialist')}</Label>
        <SpecialistSelect
          current={split.specialist}
          options={options}
          label={t('pipelines.splitSpecialistLabel')}
          disabled={disabled}
          onChange={(next) => onSplit({ specialist: next })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="split-max">{t('pipelines.maxGroups')}</Label>
        <Input
          id="split-max"
          type="text"
          value={split.maxGroups}
          onChange={(event) => onSplit({ maxGroups: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t('pipelines.groupSteps')}</Label>
        <Select
          value={split.pipeline === '' ? NONE : split.pipeline}
          disabled={disabled}
          onValueChange={(next) => onSplit({ pipeline: next === NONE ? '' : next })}
        >
          <SelectTrigger aria-label={t('pipelines.groupStepsLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('pipelines.ownSteps')}</SelectItem>
            {targets.map((target) => (
              <SelectItem key={target} value={target}>
                {nameOf(target)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="split-prompt">{t('pipelines.splitPrompt')}</Label>
        <Textarea
          id="split-prompt"
          rows={2}
          value={split.additionalPrompt}
          onChange={(event) => onSplit({ additionalPrompt: event.target.value })}
        />
      </div>
      {errors.map((error) => (
        <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
          {fieldLabel(error.path)}: {error.message}
        </p>
      ))}
    </>
  );
}

/** The settings of a split: the specialist, the groups limit, whose steps the groups follow. */
export function SplitFieldset({
  split,
  options,
  targets,
  nameOf,
  disabled,
  errors,
  onSplit,
}: {
  split: SplitDraft | null;
  options: SpecialistOption[];
  /** Pipelines whose steps the groups can follow. */
  targets: string[];
  nameOf: (pipeline: string) => string;
  disabled: boolean;
  errors: FieldError[];
  onSplit: (patch: Partial<SplitDraft> | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border bg-card p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{t('pipelines.split')}</legend>
      <div className="flex items-center gap-2">
        <Switch
          id="split-enabled"
          checked={split !== null}
          disabled={disabled}
          onCheckedChange={(on) => onSplit(on ? {} : null)}
          aria-label={t('pipelines.split')}
        />
        <Label htmlFor="split-enabled">
          {split ? t('pipelines.removeSplit') : t('pipelines.addSplit')}
        </Label>
      </div>
      {split ? (
        <SplitDetails
          split={split}
          options={options}
          targets={targets}
          nameOf={nameOf}
          disabled={disabled}
          errors={errors}
          onSplit={onSplit}
        />
      ) : null}
    </fieldset>
  );
}
