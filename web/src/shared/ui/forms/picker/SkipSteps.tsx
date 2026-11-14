import { useTranslation } from 'react-i18next';

import { ToggleGroup, ToggleGroupItem } from '../toggle-group.tsx';

/** The marked steps that the pipeline still has, in the order of its steps. */
export function pruneSkip(skip: string[], steps: string[]): string[] {
  return steps.filter((step) => skip.includes(step));
}

/** Segments of the steps a task skips (pressed = skipped); at least one step stays unpressed. */
export function SkipSteps({
  idPrefix,
  steps,
  skip,
  variantSkip = [],
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  steps: { id: string; name: string }[];
  skip: string[];
  /** Steps the variant of the task skips: shown marked and cannot be changed. */
  variantSkip?: string[];
  disabled?: boolean;
  onChange: (skip: string[]) => void;
}) {
  const { t } = useTranslation();
  const ids = steps.map((step) => step.id);
  const fixed = pruneSkip(variantSkip, ids);
  const marked = pruneSkip([...skip, ...fixed], ids);
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">{t('queue.form.skip')}</legend>
      {steps.length === 0 ? (
        <span className="text-xs text-muted-foreground">{t('queue.form.skipNoSteps')}</span>
      ) : (
        <ToggleGroup
          type="multiple"
          className="h-auto flex-wrap"
          value={marked}
          onValueChange={(value) =>
            onChange(
              pruneSkip(
                value.filter((step) => !fixed.includes(step)),
                ids,
              ),
            )
          }
        >
          {steps.map((step) => (
            <ToggleGroupItem
              key={step.id}
              id={`${idPrefix}-skip-${step.id}`}
              value={step.id}
              title={
                fixed.includes(step.id) ? t('queue.form.skipByVariant', { id: step.id }) : step.id
              }
              disabled={
                disabled ||
                fixed.includes(step.id) ||
                (!marked.includes(step.id) && marked.length === steps.length - 1)
              }
              className="data-[state=on]:line-through"
            >
              {step.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </fieldset>
  );
}
