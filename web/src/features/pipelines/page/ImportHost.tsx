import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { PipelineImportDialog } from '../PipelineImportDialog.tsx';
import type { PipelineFilterState } from './usePipelineFilterState.ts';
import type { PipelinesData } from './usePipelinesData.ts';

/** The import dialog, once the configuration of the repository is known. */
export function ImportHost(props: {
  api: Api;
  data: PipelinesData;
  filters: PipelineFilterState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { view, load } = props.data;
  if (!view || !props.filters.repository) return null;
  return (
    <PipelineImportDialog
      api={props.api}
      repository={props.filters.repository}
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
