import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../feedback/badge.tsx';
import { Popover, PopoverContent } from '../../overlays/popover.tsx';
import { AddTrigger, ValueChip } from './pickerParts.tsx';
import { SkipStepsList, skipLocked } from './SkipStepsList.tsx';

export { skipLocked };

/** The marked steps that the pipeline still has, in the order of its steps. */
export function pruneSkip(skip: string[], steps: string[]): string[] {
  return steps.filter((step) => skip.includes(step));
}

/**
 * A multiselect of the steps a task skips: a frame with chips of the skipped steps and «Add»,
 * which opens the list of the steps. At least one step stays unmarked.
 */
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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const ids = steps.map((step) => step.id);
  const fixed = pruneSkip(variantSkip, ids);
  const marked = pruneSkip([...skip, ...fixed], ids);
  const nameOf = (id: string) => steps.find((step) => step.id === id)?.name ?? id;
  const toggle = (id: string) => {
    const next = marked.includes(id) ? marked.filter((step) => step !== id) : [...marked, id];
    onChange(
      pruneSkip(
        next.filter((step) => !fixed.includes(step)),
        ids,
      ),
    );
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">{t('queue.form.skip')}</legend>
      {steps.length === 0 ? (
        <span className="text-xs text-muted-foreground">{t('queue.form.skipNoSteps')}</span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <div className="flex min-h-9.5 min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5">
            {marked.map((id) =>
              fixed.includes(id) ? (
                <Badge key={id} variant="mute" title={t('queue.form.skipByVariant', { id })}>
                  {nameOf(id)}
                </Badge>
              ) : (
                <ValueChip
                  key={id}
                  text={nameOf(id)}
                  icon={null}
                  hint={id}
                  note={null}
                  disabled={disabled}
                  onRemove={() => toggle(id)}
                />
              ),
            )}
            <AddTrigger
              id={`${idPrefix}-skip`}
              label={t('queue.form.skip')}
              open={open}
              listId={listId}
              disabled={disabled}
            />
          </div>
          <PopoverContent className="p-0">
            <SkipStepsList
              idPrefix={idPrefix}
              listId={listId}
              steps={steps}
              marked={marked}
              fixed={fixed}
              disabled={disabled}
              onToggle={toggle}
            />
          </PopoverContent>
        </Popover>
      )}
    </fieldset>
  );
}
