import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { PipelineCanvas } from './canvas/PipelineCanvas.tsx';
import type { usePipelineEditor } from './usePipelineEditor.ts';

/** The diagram of the draft: it edits the draft the form edits; the daemon checks it. */
export function SchemaTab({
  editor,
  view,
  sharedOnly,
  disabled,
}: {
  editor: ReturnType<typeof usePipelineEditor>;
  view: ConfigEditorResponse;
  sharedOnly: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { stale } = editor.preview;
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t('pipelines.schemaLabel')}>
      <h3 className="flex items-center gap-2 font-semibold">
        <GitBranch className="size-4" aria-hidden />
        {t('pipelines.schema')}{' '}
        {stale ? <Badge variant="warn">{t('pipelines.stale')}</Badge> : null}
      </h3>
      {stale ? (
        <p className="text-sm text-muted-foreground">{t('pipelines.previewInvalid')}</p>
      ) : null}
      <PipelineCanvas editor={editor} view={view} sharedOnly={sharedOnly} disabled={disabled} />
    </section>
  );
}
