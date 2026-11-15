import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { PipelineImportDialog } from '../PipelineImportDialog.tsx';
import type { PipelinesData } from './usePipelinesData.ts';

/** The import dialog, once the configuration of the repository is known. */
export function ImportHost(props: {
  api: Api;
  data: PipelinesData;
  /** The path of the repository whose pipelines are imported into. */
  repository: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { view, load } = props.data;
  if (!view || !props.repository) return null;
  return (
    <PipelineImportDialog
      api={props.api}
      repository={props.repository}
      pipelines={view.pipelines}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onImported={async (ids) => {
        await load();
        notifySuccess(t('pipelines.import.done', { total: ids.length }));
      }}
    />
  );
}
