import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { FORM_STEPS, type FormErrors, type FormStep } from './draft.ts';

/** A labelled field with a hint and the error under it. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** The error of a field: what the daemon said, else the form's own code translated. */
export function useErrorText(local: FormErrors, server: Record<string, string>) {
  const { t } = useTranslation();
  return (field: string): string | undefined => {
    if (server[field]) return server[field];
    const code = local[field];
    return code
      ? t(`providers.form.errors.${code}` as 'providers.form.errors.required')
      : undefined;
  };
}

/** The steps «Name» → «Access» → «Models» with the current one marked. */
export function StepIndicator({
  step,
  onStep,
}: {
  step: FormStep;
  onStep: (step: FormStep) => void;
}) {
  const { t } = useTranslation();
  const current = FORM_STEPS.indexOf(step);
  return (
    <ol aria-label={t('providers.form.steps')} className="flex flex-wrap gap-2 text-sm">
      {FORM_STEPS.map((item, index) => (
        <li key={item}>
          <button
            type="button"
            aria-current={item === step ? 'step' : undefined}
            disabled={index > current}
            onClick={() => onStep(item)}
            className={cn(
              'rounded-full border px-3 py-1 disabled:opacity-50',
              item === step ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground',
            )}
          >
            {index + 1}. {t(`providers.form.step.${item}`)}
          </button>
        </li>
      ))}
    </ol>
  );
}
