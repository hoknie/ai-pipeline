import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { notifySuccess } from '../../notify.ts';
import type { RunView } from '../../types.ts';
import { Switch } from '../../ui/switch.tsx';

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
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  if (!run.steps || run.steps.length === 0) return null;
  const toggle = async (id: string, skip: boolean) => {
    const busy = run.topology.steps
      .find((step) => step.id === id)
      ?.groups.some((group) => group.status === 'running' || group.status === 'needs_human');
    if (skip && busy) {
      const yes = await confirm({
        title: t('runs.steps.confirmTitle', { step: id }),
        description: t('runs.steps.confirmDescription'),
        confirmLabel: t('runs.steps.confirmLabel'),
        cancelLabel: t('runs.steps.keep'),
        destructive: true,
      });
      if (!yes) return;
    }
    setPending(id);
    try {
      await api.skipStep(run.id, id, skip);
      notifySuccess(t(skip ? 'runs.steps.doneSkip' : 'runs.steps.doneUnskip'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending(null);
    }
  };
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
            <Switch
              checked={step.skipped}
              disabled={pending !== null}
              aria-label={t('runs.steps.switchLabel', { step: step.id })}
              onCheckedChange={(checked) => void toggle(step.id, checked)}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
