import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { notifySuccess } from '../../notify.ts';
import type { RunView } from '../../types.ts';

/** The step of the workflow the group stands on, from the topology of the run; `null` when it stands on none. */
export function stepOfGroup(run: RunView, slug: string): string | null {
  return run.topology.steps.find((step) => step.groups.some((g) => g.slug === slug))?.id ?? null;
}

/** Whether a group on the step has an attempt running or waits for an answer. */
export function busyStep(run: RunView, step: string): boolean {
  return (
    run.topology.steps
      .find((s) => s.id === step)
      ?.groups.some((g) => g.status === 'running' || g.status === 'needs_human') ?? false
  );
}

/** Skip or bring back a step of the run, with a confirmation when work would be lost or other groups are touched. */
export function useSkipStep(
  run: RunView | undefined,
  api: Api,
  onError: (message: string) => void,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const toggle = async (step: string, skip: boolean, options: { allGroups?: boolean } = {}) => {
    if (!run) return;
    const busy = busyStep(run, step);
    if (skip && (busy || options.allGroups)) {
      const description = [
        busy ? t('runs.steps.confirmDescription') : null,
        options.allGroups ? t('runs.steps.confirmAllGroups') : null,
      ]
        .filter(Boolean)
        .join(' ');
      const yes = await confirm({
        title: t('runs.steps.confirmTitle', {
          step: run.steps.find((candidate) => candidate.id === step)?.name ?? step,
        }),
        description,
        confirmLabel: t('runs.steps.confirmLabel'),
        cancelLabel: t('runs.steps.keep'),
        destructive: true,
      });
      if (!yes) return;
    }
    setPending(step);
    try {
      await api.skipStep(run.id, step, skip);
      notifySuccess(t(skip ? 'runs.steps.doneSkip' : 'runs.steps.doneUnskip'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending(null);
    }
  };
  return { pending, toggle };
}
