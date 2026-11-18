import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '../../overlays/popover.tsx';
import { Label } from '../label.tsx';
import { selectTriggerClass } from '../select.tsx';
import { SkipStepsList, skipLocked } from './SkipStepsList.tsx';

export { skipLocked };

/** The marked steps that the pipeline still has, in the order of its steps. */
export function pruneSkip(skip: string[], steps: string[]): string[] {
  return steps.filter((step) => skip.includes(step));
}

/**
 * A multiselect of the steps a task skips: a dropdown field like a select showing the names of the
 * skipped steps, which opens the list of the steps. At least one step stays unmarked.
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
  const label = marked.map(nameOf).join(', ');
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-skip`}>{t('queue.form.skip')}</Label>
      {steps.length === 0 ? (
        <span className="text-xs text-muted-foreground">{t('queue.form.skipNoSteps')}</span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={`${idPrefix}-skip`}
              role="combobox"
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-controls={open ? listId : undefined}
              disabled={disabled}
              title={label}
              data-placeholder={marked.length === 0 ? '' : undefined}
              className={selectTriggerClass}
            >
              <span className="min-w-0 truncate">{label || t('queue.form.skipNone')}</span>
              <ChevronDown className="size-4 shrink-0 opacity-60" />
            </button>
          </PopoverTrigger>
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
    </div>
  );
}
