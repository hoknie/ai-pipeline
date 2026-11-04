import { useTranslation } from 'react-i18next';

import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';

/** The marked steps that the workflow still has, in the order of its steps. */
export function pruneSkip(skip: string[], steps: string[]): string[] {
  return steps.filter((step) => skip.includes(step));
}

/** Segments of the steps a task skips (pressed = skipped); at least one step stays unpressed. */
export function SkipSteps({
  idPrefix,
  steps,
  skip,
  onChange,
}: {
  idPrefix: string;
  steps: { id: string; name: string }[];
  skip: string[];
  onChange: (skip: string[]) => void;
}) {
  const { t } = useTranslation();
  const ids = steps.map((step) => step.id);
  const marked = pruneSkip(skip, ids);
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
          onValueChange={(value) => onChange(pruneSkip(value, ids))}
        >
          {steps.map((step) => (
            <ToggleGroupItem
              key={step.id}
              id={`${idPrefix}-skip-${step.id}`}
              value={step.id}
              title={step.id}
              disabled={!marked.includes(step.id) && marked.length === steps.length - 1}
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
