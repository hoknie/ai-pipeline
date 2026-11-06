import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import type { RunView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Checkbox } from '../../ui/checkbox.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.tsx';

import { useSkipStep } from './skipStep.tsx';

/** The steps of the group pipeline in a list of checkboxes; a cleared box skips the step for the run. */
export function RunSteps({
  run,
  api,
  onError,
}: {
  run: RunView;
  api: Api;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { pending, toggle } = useSkipStep(run, api, onError);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const change = async (step: string, skip: boolean) => {
    setConfirming(true);
    try {
      await toggle(step, skip);
    } finally {
      setConfirming(false);
    }
  };
  if (!run.steps || run.steps.length === 0) return null;
  const active = run.steps.filter((step) => !step.skipped);
  const last = active.length === 1 ? active[0] : undefined;
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next || confirming || pending !== null)}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          {t('runs.steps.button', { active: active.length, total: run.steps.length })}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <ul aria-label={t('runs.steps.title')} className="flex flex-col gap-1 text-sm">
          {run.steps.map((step) => (
            <li key={step.id} className="flex list-none items-center gap-2 px-1 py-0.5">
              <Checkbox
                id={`run-step-${step.id}`}
                checked={!step.skipped}
                disabled={pending !== null || step.state === 'done' || last?.id === step.id}
                aria-label={t('runs.steps.checkboxLabel', {
                  name: step.name.endsWith(` (${step.id})`)
                    ? step.name.slice(0, -` (${step.id})`.length)
                    : step.name,
                  step: step.id,
                })}
                onCheckedChange={(checked) => void change(step.id, checked !== true)}
              />
              <span className={step.skipped ? 'line-through' : undefined}>{step.name}</span>
              {step.name.endsWith(` (${step.id})`) ? null : (
                <code className="text-xs text-muted-foreground">{step.id}</code>
              )}
              <span className="ml-auto pl-3 text-xs text-muted-foreground">
                {step.skipped ? t('runs.steps.skipped') : t(`runs.steps.${step.state}`)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
