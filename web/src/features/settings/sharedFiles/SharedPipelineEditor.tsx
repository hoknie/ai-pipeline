import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { ConfigEditorResponse, EditorPipeline } from '../../../shared/api/types.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { PipelineForm } from '../../pipelines/index.ts';
import { NEW_SHARED_PIPELINE } from './constants.ts';
import type { SharedPipelinesState } from './useSharedPipelines.ts';

type Props = {
  api: Api;
  config: ConfigEditorResponse;
  selected: string | null;
  onSelect: (id: string | null) => void;
  dirty: { current: boolean };
  state: SharedPipelinesState;
};

/** The form of the open shared pipeline. */
function OpenForm(props: Props & { pipeline: EditorPipeline }) {
  const { t } = useTranslation();
  const { api, config, onSelect, dirty, state, pipeline } = props;
  const { usage, usageError, notice, setNotice, loadUsage, refresh, onDirty } = state;
  return (
    <PipelineForm
      key={`${pipeline.id}:${pipeline.revision ?? ''}`}
      api={api}
      view={config}
      pipeline={pipeline}
      activeRuns={0}
      notice={notice}
      sharedOnly={{
        usage:
          usage === null
            ? null
            : (usage.pipelines.find((entry) => entry.id === pipeline.id) ?? {
                id: pipeline.id,
                name: null,
                tags: [],
                file: pipeline.file,
                revision: pipeline.revision,
                global: [],
                projects: [],
              }),
        usageError,
        onUsageStale: () => void loadUsage(),
      }}
      onDirty={onDirty}
      onReload={refresh}
      onSaved={async () => {
        dirty.current = false;
        await refresh();
        setNotice(t('pipelines.saved'));
        notifySuccess(t('pipelines.savedToast'));
      }}
      onDeleted={async () => {
        dirty.current = false;
        setNotice(null);
        const id = pipeline.id;
        await refresh();
        notifySuccess(t('pipelines.deletedToast', { id }));
        onSelect(null);
      }}
    />
  );
}

/** The form of the open shared pipeline, the form of a new one, or the empty screen. */
export function SharedPipelineEditor(props: Props) {
  const { t } = useTranslation();
  const { api, config, selected, onSelect, dirty, state } = props;
  const { setNotice, loadUsage, refresh, onDirty, pipeline } = state;
  return (
    <>
      {selected === NEW_SHARED_PIPELINE ? (
        <PipelineForm
          key="new"
          api={api}
          view={config}
          pipeline={null}
          activeRuns={0}
          notice={null}
          sharedOnly={{ usage: null, usageError: null, onUsageStale: () => void loadUsage() }}
          onDirty={onDirty}
          onReload={refresh}
          onSaved={async (id) => {
            dirty.current = false;
            await refresh();
            setNotice(t('pipelines.saved'));
            notifySuccess(t('pipelines.savedToast'));
            onSelect(id);
          }}
          onDeleted={async () => undefined}
        />
      ) : pipeline ? (
        <OpenForm {...props} pipeline={pipeline} />
      ) : (
        <Empty icon={<GitBranch />} title={t('pipelines.empty')} />
      )}
    </>
  );
}
