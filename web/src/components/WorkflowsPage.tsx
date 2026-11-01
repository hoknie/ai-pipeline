import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { GitBranch, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useConfirm } from '../confirm.tsx';
import { notifySuccess } from '../notify.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';
import { Skeleton } from '../ui/skeleton.tsx';
import type { Api } from '../api.ts';
import type { ConfigEditorResponse, RunView } from '../types.ts';

import { ConfigErrors, EntryList, SplitPage } from './EntryList.tsx';
import { LEVEL_KEYS, NEW_ID } from './SpecialistsPage.tsx';
import { WorkflowForm } from './WorkflowForm.tsx';

export default function WorkflowsPage({
  api,
  runs,
  selected,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  runs: RunView[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Whether the open form has unsaved edits; the caller owns it to guard other navigation. */
  dirty?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ConfigEditorResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirm();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;

  const load = useCallback(async () => {
    try {
      setView(await api.config());
      setFailure(null);
    } catch (error) {
      setFailure((error as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = async (id: string | null) => {
    if (id === selected) return;
    if (
      dirty.current &&
      !(await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    dirty.current = false;
    setNotice(null);
    onSelect(id);
  };

  const workflow = view?.workflows.find((candidate) => candidate.id === selected) ?? null;
  const activeRuns = (id: string) =>
    runs.filter((run) => run.workflow === id && !run.finished).length;
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  return (
    <SplitPage
      side={
        <>
          {failure ? <Alert variant="destructive">{failure}</Alert> : null}
          {view ? <ConfigErrors errors={view.errors} /> : null}
          <Button onClick={() => void go(NEW_ID)}>
            <Plus />
            {t('workflows.new')}
          </Button>
          <EntryList
            label="workflow"
            selected={selected}
            onSelect={(id) => void go(id)}
            entries={(view?.workflows ?? []).map((entry) => ({
              id: entry.id,
              title: entry.id,
              tag: t(`settings.editor.levels.${LEVEL_KEYS[entry.level]}`),
            }))}
          />
        </>
      }
    >
      {!view ? (
        failure ? null : (
          <div role="status" aria-label={t('settings.editor.loading')}>
            <Skeleton className="h-40" />
          </div>
        )
      ) : selected === NEW_ID ? (
        <WorkflowForm
          key="new"
          api={api}
          view={view}
          workflow={null}
          activeRuns={0}
          notice={null}
          onDirty={onDirty}
          onReload={load}
          onSaved={async (id) => {
            dirty.current = false;
            await load();
            setNotice(t('workflows.saved'));
            notifySuccess(t('workflows.savedToast'));
            onSelect(id);
          }}
          onDeleted={async () => undefined}
        />
      ) : workflow ? (
        <WorkflowForm
          key={`${workflow.id}:${workflow.level}:${workflow.sources.project?.revision ?? ''}:${workflow.sources.global?.revision ?? ''}`}
          api={api}
          view={view}
          workflow={workflow}
          activeRuns={activeRuns(workflow.id)}
          notice={notice}
          onDirty={onDirty}
          onReload={load}
          onSaved={async (id) => {
            dirty.current = false;
            await load();
            setNotice(t('workflows.saved'));
            notifySuccess(t('workflows.savedToast'));
            if (id !== selected) onSelect(id);
          }}
          onDeleted={async () => {
            dirty.current = false;
            setNotice(null);
            await load();
            notifySuccess(t('workflows.deletedToast', { id: selected ?? '' }));
          }}
        />
      ) : (
        <Empty icon={<GitBranch />} title={t('workflows.empty')} />
      )}
    </SplitPage>
  );
}
