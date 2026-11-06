import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { notifySuccess } from '../../notify.ts';
import type { ConfigEditorResponse, EditorPipeline, SharedPipelinesView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Input } from '../../ui/input.tsx';

import { ConfigErrors, EntryList, SplitPage } from '../EntryList.tsx';
import { SpecialistTagChip } from '../SpecialistTagChip.tsx';
import { PipelineForm } from '../PipelineForm.tsx';
import { rawName } from '../pipelineName.ts';

export const NEW_SHARED_PIPELINE = 'new';

/** The pipeline as its shared file has it: the only file this group edits. */
function sharedOf(pipeline: EditorPipeline): EditorPipeline | null {
  const shared = pipeline.sources.global;
  if (!shared) return null;
  return {
    ...pipeline,
    level: 'global',
    file: shared.file,
    revision: shared.revision,
    raw: shared.raw,
    sources: { global: shared },
  };
}

/**
 * The group «Pipeline» of the shared tab: the files of the shared pipelines directory, editable,
 * with the repositories that use each of them.
 */
export function SharedPipelinesGroup({
  api,
  config,
  selected,
  onSelect,
  onReload,
  dirty,
}: {
  api: Api;
  config: ConfigEditorResponse;
  /** Id of the open pipeline, `new` for the new one, or null. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [usage, setUsage] = useState<SharedPipelinesView | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await api.sharedPipelines());
      setUsageError(null);
    } catch (error) {
      setUsage(null);
      setUsageError((error as Error).message);
    }
  }, [api]);
  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const shared = useMemo(
    () => config.pipelines.map(sharedOf).filter((entry): entry is EditorPipeline => entry !== null),
    [config],
  );
  const directory = usage?.directory ?? `${config.directories.global}/pipelines`;
  const fileErrors = config.errors.filter((error) => error.file?.startsWith(`${directory}/`));
  const query = search.trim().toLocaleLowerCase();
  const shown = shared.filter(
    (entry) =>
      query === '' ||
      entry.id.toLocaleLowerCase().includes(query) ||
      (rawName(entry.raw) ?? '').toLocaleLowerCase().includes(query) ||
      entry.shared_tags.some((tag) => tag.toLocaleLowerCase().includes(query)),
  );
  const pipeline = shared.find((entry) => entry.id === selected) ?? null;

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

  const refresh = async () => {
    await Promise.all([onReload(), loadUsage()]);
  };
  const onDirty = (value: boolean) => {
    dirty.current = value;
  };

  return (
    <SplitPage
      side={
        <>
          {fileErrors.length > 0 ? <ConfigErrors errors={fileErrors} /> : null}
          <Button onClick={() => void go(NEW_SHARED_PIPELINE)}>
            <Plus />
            {t('pipelines.new')}
          </Button>
          <Input
            type="search"
            value={search}
            aria-label={t('sharedPipelines.search')}
            placeholder={t('sharedPipelines.search')}
            onChange={(event) => setSearch(event.target.value)}
          />
          {shared.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sharedPipelines.empty')}</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sharedPipelines.nothing')}</p>
          ) : null}
          <EntryList
            label={t('sharedPipelines.list')}
            selected={selected}
            onSelect={(id) => void go(id)}
            entries={shown.map((entry) => ({
              id: entry.id,
              title: rawName(entry.raw) ?? entry.id,
              subtitle: entry.id,
              extra:
                entry.shared_tags.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {entry.shared_tags.map((tag) => (
                      <SpecialistTagChip key={tag} name={tag} />
                    ))}
                  </span>
                ) : undefined,
            }))}
          />
        </>
      }
    >
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
      ) : (
        <Empty icon={<GitBranch />} title={t('pipelines.empty')} />
      )}
    </SplitPage>
  );
}
