import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
} from '../../../shared/api/types.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { SpecialistForm } from '../form/SpecialistForm.tsx';

export const NEW_ID = 'new';

/** The right side of the page: the form of the chosen specialist or of a new one. */
export function SpecialistPane({
  api,
  view,
  failure,
  catalog,
  catalogError,
  selected,
  notice,
  dirty,
  load,
  onSelect,
  onNotice,
}: {
  api: Api;
  view: ConfigEditorResponse | null;
  failure: string | null;
  catalog: ConfigCatalogResponse | null;
  catalogError: string | null;
  selected: string | null;
  notice: string | null;
  dirty: { current: boolean };
  load: () => Promise<void>;
  onSelect: (id: string | null) => void;
  onNotice: (notice: string | null) => void;
}) {
  const { t } = useTranslation();
  if (!view) {
    if (failure) return null;
    return (
      <div role="status" aria-label={t('settings.editor.loading')}>
        <Skeleton className="h-40" />
      </div>
    );
  }
  const specialist = view.specialists.find((candidate) => candidate.slug === selected) ?? null;
  if (selected !== NEW_ID && !specialist) {
    return <Empty icon={<Users />} title={t('specialists.empty')} />;
  }
  const saved = async (slug: string) => {
    dirty.current = false;
    await load();
    onNotice(t('specialists.saved'));
    notifySuccess(t('specialists.savedToast'));
    if (selected === NEW_ID || slug !== selected) onSelect(slug);
  };
  return (
    <SpecialistForm
      key={
        specialist
          ? `${specialist.slug}:${specialist.level}:${specialist.sources.project?.revision ?? ''}:${specialist.sources.global?.revision ?? ''}`
          : 'new'
      }
      api={api}
      view={view}
      specialist={specialist as EditorSpecialist | null}
      catalog={catalog}
      catalogError={catalogError}
      notice={specialist ? notice : null}
      onDirty={(value) => (dirty.current = value)}
      onReload={load}
      onSaved={saved}
      onDeleted={async () => {
        if (!specialist) return;
        dirty.current = false;
        onNotice(null);
        await load();
        notifySuccess(t('specialists.deletedToast', { id: selected ?? '' }));
      }}
    />
  );
}
