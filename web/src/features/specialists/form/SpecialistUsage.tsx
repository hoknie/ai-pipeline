import { useTranslation } from 'react-i18next';

import type {
  ConfigEditorResponse,
  EntryReference,
  SharedSpecialistView,
} from '../../../shared/api/types.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Card } from '../../../shared/ui/layout/card.tsx';

export function describeReference(
  reference: EntryReference,
  view: ConfigEditorResponse | null,
): string {
  const where = (() => {
    if (reference.field) return reference.field;
    const entry = reference.repository
      ? undefined
      : view?.pipelines.find((candidate) => candidate.id === reference.pipeline);
    const pipeline = (entry ? rawName(entry.raw) : null) ?? reference.pipeline;
    if (reference.split) return `${pipeline} → split`;
    return `${pipeline} → ${reference.step}`;
  })();
  return reference.repository ? `${repositoryLabel(reference.repository)}: ${where}` : where;
}

/** The shared-level view of the form: the usage of the specialist by the projects. */
export interface SharedOnly {
  /** Usage of the open specialist; null while it is not loaded. */
  usage: SharedSpecialistView | null;
  usageError: string | null;
  /** Reads the usage again, for example after the daemon refused a delete. */
  onUsageStale: () => void;
}

export function UsageBlock({ shared, view }: { shared: SharedOnly; view: ConfigEditorResponse }) {
  const { t } = useTranslation();
  const { usage, usageError } = shared;
  return (
    <Card>
      <section aria-labelledby="usage-title" className="flex flex-col gap-2 p-4">
        <h3 id="usage-title" className="text-sm font-semibold">
          {t('sharedSpecialists.usage.title')}
        </h3>
        {usageError ? (
          <Alert variant="destructive">
            {t('sharedSpecialists.usage.error', { message: usageError })}
          </Alert>
        ) : usage === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('sharedSpecialists.usage.loading')}
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="usage-count">
              {t('sharedSpecialists.usage.count', { count: usage.projects.length })}
            </p>
            {usage.projects.length === 0 && usage.global.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('sharedSpecialists.usage.none')}</p>
            ) : null}
            <ul aria-label={t('sharedSpecialists.usage.title')} className="flex flex-col gap-1">
              {usage.global.length > 0 ? (
                <li className="text-sm">
                  <span className="font-medium">{t('sharedSpecialists.usage.shared')}</span>:{' '}
                  {usage.global.map((reference) => describeReference(reference, view)).join(', ')}
                </li>
              ) : null}
              {usage.projects.map((project) => (
                <li key={project.repository} className="text-sm">
                  <span className="font-medium" title={project.repository}>
                    {repositoryLabel(project.repository)}
                  </span>
                  :{' '}
                  {project.references
                    .map((reference) => describeReference(reference, null))
                    .join(', ')}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Card>
  );
}
