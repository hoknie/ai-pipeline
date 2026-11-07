import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type {
  ConfigEditorResponse,
  EditorPipeline,
  SharedPipelinesView,
} from '../../../shared/api/types.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';

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

export interface SharedPipelinesArgs {
  api: Api;
  config: ConfigEditorResponse;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}

/** The files of the shared pipelines, their usage, the search and the guarded choice of a file. */
export function useSharedPipelines(args: SharedPipelinesArgs) {
  const { api, config, selected, onSelect, onReload, dirty } = args;
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
  return {
    usage,
    usageError,
    notice,
    setNotice,
    search,
    setSearch,
    loadUsage,
    shared,
    fileErrors,
    shown,
    pipeline,
    go,
    refresh,
    onDirty,
  };
}

export type SharedPipelinesState = ReturnType<typeof useSharedPipelines>;
