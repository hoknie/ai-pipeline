import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useConfirm } from '../confirm.tsx';
import { notifySuccess } from '../notify.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Empty } from '../ui/empty.tsx';
import { Skeleton } from '../ui/skeleton.tsx';
import type { Api } from '../api.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
  EntryLevel,
} from '../types.ts';

import { ConfigErrors, EntryList, SplitPage } from './EntryList.tsx';
import { SpecialistForm } from './SpecialistForm.tsx';

export const NEW_ID = 'new';

/** Key of the label of a level in the dictionaries, under `settings.editor.levels`. */
export const LEVEL_KEYS: Record<EntryLevel, EntryLevel> = {
  project: 'project',
  global: 'global',
  project_over_global: 'project_over_global',
};

export default function SpecialistsPage({
  api,
  selected,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Whether the open form has unsaved edits; the caller owns it to guard other navigation. */
  dirty?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<ConfigEditorResponse | null>(null);
  const [catalog, setCatalog] = useState<ConfigCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirm();
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;

  const load = useCallback(async () => {
    // The catalog only helps the form: its failure leaves the lists free to type in.
    const loading = api.catalog().then(
      (value) => ({ value, message: null }),
      (error: Error) => ({ value: null, message: error.message }),
    );
    try {
      setView(await api.config());
      setFailure(null);
    } catch (error) {
      setFailure((error as Error).message);
    }
    const result = await loading;
    setCatalog(result.value);
    setCatalogError(result.message);
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

  const specialist = view?.specialists.find((candidate) => candidate.slug === selected) ?? null;

  return (
    <SplitPage
      side={
        <>
          {failure ? <Alert variant="destructive">{failure}</Alert> : null}
          {view ? <ConfigErrors errors={view.errors} /> : null}
          <Button onClick={() => void go(NEW_ID)}>
            <Plus />
            {t('specialists.new')}
          </Button>
          <EntryList
            label={t('specialists.list')}
            selected={selected}
            onSelect={(id) => void go(id)}
            entries={(view?.specialists ?? []).map((entry) => ({
              id: entry.slug,
              title: entry.slug,
              subtitle: [
                entry.effective?.name ?? entry.raw.name?.toString(),
                entry.effective
                  ? `${entry.effective.runtime}${entry.effective.model ? ` · ${entry.effective.model}` : ''}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
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
        <SpecialistForm
          key="new"
          api={api}
          view={view}
          specialist={null}
          catalog={catalog}
          catalogError={catalogError}
          notice={null}
          onDirty={(value) => (dirty.current = value)}
          onReload={load}
          onSaved={async (slug) => {
            dirty.current = false;
            await load();
            setNotice(t('specialists.saved'));
            notifySuccess(t('specialists.savedToast'));
            onSelect(slug);
          }}
          onDeleted={async () => undefined}
        />
      ) : specialist ? (
        <SpecialistForm
          key={`${specialist.slug}:${specialist.level}:${specialist.sources.project?.revision ?? ''}:${specialist.sources.global?.revision ?? ''}`}
          api={api}
          view={view}
          specialist={specialist as EditorSpecialist}
          catalog={catalog}
          catalogError={catalogError}
          notice={notice}
          onDirty={(value) => (dirty.current = value)}
          onReload={load}
          onSaved={async (slug) => {
            dirty.current = false;
            await load();
            setNotice(t('specialists.saved'));
            notifySuccess(t('specialists.savedToast'));
            if (slug !== selected) onSelect(slug);
          }}
          onDeleted={async () => {
            dirty.current = false;
            setNotice(null);
            await load();
            notifySuccess(t('specialists.deletedToast', { id: selected ?? '' }));
          }}
        />
      ) : (
        <Empty icon={<Users />} title={t('specialists.empty')} />
      )}
    </SplitPage>
  );
}
