import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PipelineTopology } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { PipelineGraph } from '../../topology/index.ts';

/** The graph the daemon draws for the draft. */
export function PreviewTab({
  id,
  preview,
}: {
  id: string;
  preview: { topology: PipelineTopology | null; stale: boolean };
}) {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t('pipelines.previewLabel')}>
      <h3 className="flex items-center gap-2 font-semibold">
        <GitBranch className="size-4" aria-hidden />
        {t('pipelines.preview')}{' '}
        {preview.stale ? <Badge variant="warn">{t('pipelines.stale')}</Badge> : null}
      </h3>
      {preview.stale ? (
        <p className="text-sm text-muted-foreground">{t('pipelines.previewInvalid')}</p>
      ) : null}
      {preview.topology ? (
        <PipelineGraph
          key={id}
          pipeline={preview.topology}
          className="h-[calc(100dvh-16rem)] min-h-[420px]"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('pipelines.graphLater')}</p>
      )}
    </section>
  );
}
