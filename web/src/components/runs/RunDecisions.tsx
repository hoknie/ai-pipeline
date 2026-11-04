import { useTranslation } from 'react-i18next';

import type { RunView } from '../../types.ts';

const AUTHORS = ['human', 'autopilot'] as const;

/** Accepted answers of a run for its list card: counts by author, the answers in the tooltip. */
export function RunDecisions({ run }: { run: RunView }) {
  const { t } = useTranslation();
  const decisions = run.decisions ?? [];
  if (decisions.length === 0) return null;
  const first = (text: string): string => text.split('\n')[0] ?? '';
  const counts = AUTHORS.map((by) => ({
    by,
    n: decisions.filter((decision) => decision.by === by).length,
  }))
    .filter(({ n }) => n > 0)
    .map(({ by, n }) => t('runs.list.answersCount', { who: t(`runs.decisions.${by}`), n }));
  const title = decisions
    .map(
      (d) =>
        `${d.group} · ${d.stepId} (${t(`runs.decisions.${d.by}`)}): ${first(d.question)} → ${first(d.answer)}`,
    )
    .join('\n');
  return (
    <span className="text-xs text-muted-foreground" title={title}>
      {t('runs.list.answers')}: {counts.join(' · ')}
    </span>
  );
}
