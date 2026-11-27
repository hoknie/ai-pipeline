import { useTranslation } from 'react-i18next';
import type { AttemptView } from '../../../shared/api/types.ts';

export function ReviewResult({ attempt }: { attempt: AttemptView }) {
  const { t } = useTranslation();
  if (!attempt.review && !attempt.implementation && !attempt.strategy) return null;
  return (
    <section
      aria-label={t('runs.reviewCycle.title')}
      className="space-y-3 rounded-lg border p-3 text-sm"
    >
      <h4 className="font-semibold">{t('runs.reviewCycle.title')}</h4>
      {attempt.review?.findings.map((finding) => (
        <article key={finding.id} className="space-y-1 rounded border p-2">
          <p className="font-medium">
            {finding.id} · {t(`runs.reviewCycle.${finding.severity}`)} · {finding.file}
          </p>
          <p>{finding.scenario}</p>
          <p>
            {t('runs.reviewCycle.expected')}: {finding.expected}
          </p>
          <p>
            {t('runs.reviewCycle.evidence')}: {finding.evidence}
          </p>
          <p>
            {t(`runs.reviewCycle.${finding.origin}`)}: {finding.reason}
          </p>
        </article>
      ))}
      {attempt.review?.resolved.map((closure) => (
        <p key={closure.id}>
          {t('runs.reviewCycle.resolved')} {closure.id}: {closure.evidence}
        </p>
      ))}
      {attempt.implementation ? (
        <>
          <p>
            {t('runs.reviewCycle.files')}: {attempt.implementation.files.join(', ')}
          </p>
          {attempt.implementation.resolutions.map((item) => (
            <p key={item.id}>
              {item.id}: {item.change}
              <br />
              {t('runs.reviewCycle.tests')}: {item.tests}
            </p>
          ))}
          {attempt.implementation.checks.map((check) => (
            <p key={check.command}>
              <code>{check.command}</code> · {t(`runs.reviewCycle.${check.result}`)}:{' '}
              {check.evidence}
            </p>
          ))}
        </>
      ) : null}
      {attempt.strategy ? (
        <>
          <p>{attempt.strategy.summary}</p>
          <ol className="list-decimal pl-5">
            {attempt.strategy.slices.map((slice, index) => (
              <li key={index}>
                {slice.title}: {slice.acceptance}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
