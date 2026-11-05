import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { notifySuccess } from '../../notify.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
  SharedSpecialistsView,
} from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Input } from '../../ui/input.tsx';

import { ConfigErrors, EntryList, SplitPage } from '../EntryList.tsx';
import { SpecialistForm } from '../SpecialistForm.tsx';

export const NEW_SHARED = 'new';

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

/**
 * The group «Specialists» of the shared tab: the files of the shared specialists directory,
 * editable, with the repositories that use each of them.
 */
export function SharedSpecialistsGroup({
  api,
  config,
  selected,
  onSelect,
  onReload,
  dirty,
}: {
  api: Api;
  config: ConfigEditorResponse;
  /** Slug of the open specialist, `new` for the new one, or null. */
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [usage, setUsage] = useState<SharedSpecialistsView | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
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
    api.catalog().then(
      (value) => {
        setCatalog(value);
        setCatalogError(null);
      },
      (error: Error) => setCatalogError(error.message),
    );
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

  return (
    <SplitPage
      side={
        <>
          {fileErrors.length > 0 ? <ConfigErrors errors={fileErrors} /> : null}
          <Button onClick={() => void go(NEW_SHARED)}>
            <Plus />
            {t('specialists.new')}
          </Button>
          <Input
            type="search"
            value={search}
            aria-label={t('sharedSpecialists.search')}
            placeholder={t('sharedSpecialists.search')}
            onChange={(event) => setSearch(event.target.value)}
          />
          {shared.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sharedSpecialists.empty')}</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('sharedSpecialists.nothing')}</p>
          ) : null}
          <EntryList
            label={t('sharedSpecialists.list')}
            selected={selected}
            onSelect={(slug) => void go(slug)}
            entries={shown.map((entry) => ({
              id: entry.slug,
              title: String(entry.raw.name ?? entry.slug),
              subtitle: entry.slug,
            }))}
          />
        </>
      }
    >
      {selected === NEW_SHARED ? (
        <SpecialistForm
          key="new"
          api={api}
          view={config}
          specialist={null}
          catalog={catalog}
          catalogError={catalogError}
          notice={null}
          sharedOnly={{ usage: null, usageError: null, onUsageStale: () => void loadUsage() }}
          onDirty={onDirty}
          onReload={refresh}
          onSaved={async (slug) => {
            dirty.current = false;
            await refresh();
            setNotice(t('specialists.saved'));
            notifySuccess(t('specialists.savedToast'));
            onSelect(slug);
          }}
          onDeleted={async () => undefined}
        />
      ) : specialist ? (
        <SpecialistForm
          key={`${specialist.slug}:${specialist.revision ?? ''}`}
          api={api}
          view={config}
          specialist={specialist}
          catalog={catalog}
          catalogError={catalogError}
          notice={notice}
          sharedOnly={{
            usage:
              usage === null
                ? null
                : (usage.specialists.find((entry) => entry.slug === specialist.slug) ?? {
                    slug: specialist.slug,
                    name: null,
                    file: specialist.file,
                    revision: specialist.revision,
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
            setNotice(t('specialists.saved'));
            notifySuccess(t('specialists.savedToast'));
          }}
          onDeleted={async () => {
            dirty.current = false;
            setNotice(null);
            const slug = specialist.slug;
            await refresh();
            notifySuccess(t('specialists.deletedToast', { id: slug }));
            onSelect(null);
          }}
        />
      ) : (
        <Empty icon={<Users />} title={t('specialists.empty')} />
      )}
    </SplitPage>
  );
}
