import { GitBranch } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, RunView } from '../../../shared/api/types.ts';
import { specialistNames } from '../../../shared/lib/catalog/specialists.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import {
  actionsOf,
  isSystemKind,
  type ActionEntry,
} from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { NEW_ID } from '../../specialists/index.ts';
import { ActionForm } from '../ActionForm.tsx';
import { PipelineForm } from '../form/PipelineForm.tsx';
import { SystemStagePage } from '../SystemStagePage.tsx';
import type { PipelinesData } from './usePipelinesData.ts';
import type { PipelineNavigation } from './usePipelineNavigation.ts';

export type BodyProps = {
  api: Api;
  runs: RunView[];
  data: PipelinesData;
  navigation: PipelineNavigation;
  selected: string | null;
  section: 'actions' | 'system' | null;
  dirty: { current: boolean };
  onSelect: (id: string | null, section?: 'actions' | 'system' | null) => void;
};

const revisions = (entry: {
  sources: { project?: { revision?: string } | null; global?: { revision?: string } | null };
}) => `${entry.sources.project?.revision ?? ''}:${entry.sources.global?.revision ?? ''}`;

function SystemBody({ data, selected }: BodyProps) {
  const { t } = useTranslation();
  const specialists = data.view?.specialists;
  const names = useMemo(() => specialistNames(specialists ?? []), [specialists]);
  if (!isSystemKind(selected))
    return <Empty icon={<GitBranch />} title={t('pipeline.system.empty')} />;
  return (
    <SystemStagePage
      key={selected}
      kind={selected}
      stages={data.stages}
      failure={data.stagesFailure}
      names={names}
    />
  );
}

function ActionsBody(props: BodyProps & { view: ConfigEditorResponse }) {
  const { t } = useTranslation();
  const { api, data, navigation, selected, dirty, onSelect, view } = props;
  const action = actionsOf(view).find((candidate) => candidate.id === selected) ?? null;
  if (selected !== NEW_ID && !action)
    return <Empty icon={<GitBranch />} title={t('pipeline.actions.empty')} />;
  return (
    <ActionForm
      key={action ? `${action.id}:${action.level}:${revisions(action)}` : 'new'}
      api={api}
      view={view}
      action={action}
      notice={navigation.notice}
      onDirty={navigation.onDirty}
      onReload={data.reload}
      onSaved={async (id) => {
        dirty.current = false;
        await data.load();
        navigation.setNotice(t('pipeline.actions.saved'));
        notifySuccess(t('pipeline.actions.savedToast'));
        if (id !== selected) onSelect(id, 'actions');
      }}
      onDeleted={async () => {
        dirty.current = false;
        navigation.setNotice(null);
        const fresh = await data.load();
        notifySuccess(t('pipeline.actions.deletedToast', { id: selected ?? '' }));
        // a failed reload says nothing about the actions: keep the address
        if (!fresh) return;
        const left: ActionEntry[] = actionsOf(fresh);
        // the other level's copy may remain: stay on it, the form is rebuilt by its key
        if (left.some((entry) => entry.id === selected)) return;
        // the address of an empty tab does not exist: open the first action left, else the new one
        navigation.lastOpen.current.actions = undefined;
        onSelect(left[0]?.id ?? NEW_ID, 'actions');
      }}
    />
  );
}

function PipelineBody(props: BodyProps & { view: ConfigEditorResponse }) {
  const { t } = useTranslation();
  const { api, runs, data, navigation, selected, dirty, onSelect, view } = props;
  const pipeline = view.pipelines.find((candidate) => candidate.id === selected) ?? null;
  if (selected !== NEW_ID && !pipeline)
    return <Empty icon={<GitBranch />} title={t('pipelines.empty')} />;
  const isNew = pipeline === null;
  return (
    <PipelineForm
      key={isNew ? 'new' : `${pipeline.id}:${pipeline.level}:${revisions(pipeline)}`}
      api={api}
      view={view}
      pipeline={pipeline}
      activeRuns={
        isNew ? 0 : runs.filter((run) => run.pipeline === pipeline.id && !run.finished).length
      }
      notice={isNew ? null : navigation.notice}
      onDirty={navigation.onDirty}
      onReload={data.reload}
      onSaved={async (id) => {
        dirty.current = false;
        await data.load();
        navigation.setNotice(t('pipelines.saved'));
        notifySuccess(t('pipelines.savedToast'));
        if (isNew || id !== selected) onSelect(id);
      }}
      onDeleted={async () => {
        if (isNew) return;
        dirty.current = false;
        navigation.setNotice(null);
        await data.load();
        notifySuccess(t('pipelines.deletedToast', { id: selected ?? '' }));
      }}
    />
  );
}

/** The editor of the open entry: a pipeline, an action or a system stage. */
export function PipelinesBody(props: BodyProps) {
  const { t } = useTranslation();
  const { view, failure } = props.data;
  if (!view) {
    return failure ? null : (
      <div role="status" aria-label={t('settings.editor.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (props.section === 'system') return <SystemBody {...props} />;
  if (props.section === 'actions') return <ActionsBody {...props} view={view} />;
  return <PipelineBody {...props} view={view} />;
}
