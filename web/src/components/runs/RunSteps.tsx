import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import type { RunView } from '../../types.ts';
import { Switch } from '../../ui/switch.tsx';

import { useSkipStep } from './skipStep.tsx';

/** The steps of the group workflow; steps that are not finished can be skipped for the run. */
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
  if (!run.steps || run.steps.length === 0) return null;
  return (
    <ol
      aria-label={t('runs.steps.title')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
    >
      <li className="list-none">{t('runs.steps.title')}:</li>
      {run.steps.map((step) => (
        <li key={step.id} className="inline-flex list-none items-center gap-1.5">
          <span className={step.skipped ? 'line-through' : undefined}>{step.id}</span>
          <span className="text-xs">
            {step.skipped ? t('runs.steps.skipped') : t(`runs.steps.${step.state}`)}
          </span>
          {step.state !== 'done' ? (
            <label className="inline-flex items-center gap-1 text-xs">
              <Switch
                checked={step.skipped}
                disabled={pending !== null}
                aria-label={t('runs.steps.switchLabel', { step: step.id })}
                onCheckedChange={(checked) => void toggle(step.id, checked)}
              />
              {t('runs.steps.skip')}
            </label>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
