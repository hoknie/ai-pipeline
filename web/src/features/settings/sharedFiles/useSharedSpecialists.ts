import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
  SharedSpecialistsView,
} from '../../../shared/api/types.ts';

/** The specialist as its shared file has it: the only file this group edits. */
function sharedOf(specialist: EditorSpecialist): EditorSpecialist | null {
  const shared = specialist.sources.global;
  if (!shared) return null;
  return {
    ...specialist,
    level: 'global',
    file: shared.file,
    revision: shared.revision,
    raw: shared.raw,
    sources: { global: shared },
  };
}

/** The catalog of the specialist fields, read once. */
function useCatalog(api: Api) {
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  useEffect(() => {
    api.catalog().then(
      (value) => {
        setCatalog(value);
        setCatalogError(null);
      },
      (error: Error) => setCatalogError(error.message),
    );
  }, [api]);
  return { catalog, catalogError };
}

export interface SharedSpecialistsArgs {
  api: Api;
  config: ConfigEditorResponse;
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}

/** The files of the shared specialists, their usage, the catalog, the search and the guarded choice. */
export function useSharedSpecialists(args: SharedSpecialistsArgs) {
  const { api, config, selected, onSelect, onReload, dirty } = args;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [usage, setUsage] = useState<SharedSpecialistsView | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const { catalog, catalogError } = useCatalog(api);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await api.sharedSpecialists());
      setUsageError(null);
    } catch (error) {
      setUsage(null);
      setUsageError((error as Error).message);
    }
  }, [api]);
  useEffect(() => {
    void loadUsage();
  }, [api, loadUsage]);

  const shared = useMemo(
    () =>
      config.specialists.map(sharedOf).filter((entry): entry is EditorSpecialist => entry !== null),
    [config],
  );
  const directory = usage?.directory ?? `${config.directories.global}/specialists`;
  const fileErrors = config.errors.filter((error) => error.file?.startsWith(`${directory}/`));
  const query = search.trim().toLocaleLowerCase();
  const shown = shared.filter(
    (entry) =>
      query === '' ||
      entry.slug.toLocaleLowerCase().includes(query) ||
      String(entry.raw.name ?? '')
        .toLocaleLowerCase()
        .includes(query),
  );
  const specialist = shared.find((entry) => entry.slug === selected) ?? null;

  const go = async (slug: string | null) => {
    if (slug === selected) return;
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
    onSelect(slug);
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
    catalog,
    catalogError,
    notice,
    setNotice,
    search,
    setSearch,
    loadUsage,
    shared,
    fileErrors,
    shown,
    specialist,
    go,
    refresh,
    onDirty,
  };
}

export type SharedSpecialistsState = ReturnType<typeof useSharedSpecialists>;
