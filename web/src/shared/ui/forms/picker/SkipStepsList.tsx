import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Command, CommandItem, CommandList } from '../../overlays/command.tsx';

/** Whether a list item cannot be toggled: the field is locked, the variant skips the step, or it is the last unmarked step. */
export function skipLocked(
  step: string,
  marked: string[],
  fixed: string[],
  total: number,
  disabled: boolean,
): boolean {
  return (
    disabled || fixed.includes(step) || (!marked.includes(step) && marked.length === total - 1)
  );
}

/** The steps of the pipeline in their order; choosing one toggles its mark and keeps the list open. */
export function SkipStepsList({
  idPrefix,
  listId,
  steps,
  marked,
  fixed,
  disabled,
  onToggle,
}: {
  idPrefix: string;
  listId: string;
  steps: { id: string; name: string }[];
  marked: string[];
  fixed: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Command>
      <CommandList id={listId}>
        {steps.map((step) => (
          <CommandItem
            key={step.id}
            value={step.id}
            aria-checked={marked.includes(step.id)}
            disabled={skipLocked(step.id, marked, fixed, steps.length, disabled)}
            title={
              fixed.includes(step.id) ? t('queue.form.skipByVariant', { id: step.id }) : step.id
            }
            onSelect={() => onToggle(step.id)}
          >
            <Check className={marked.includes(step.id) ? 'opacity-100' : 'opacity-0'} />
            <span id={`${idPrefix}-skip-${step.id}`} className="min-w-0 truncate">
              {step.name}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
