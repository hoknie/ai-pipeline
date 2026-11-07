import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { ConfigEditorResponse, EditorSpecialist } from '../../../shared/api/types.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { SpecialistForm } from '../../specialists/index.ts';
import { NEW_SHARED } from './constants.ts';
import type { SharedSpecialistsState } from './useSharedSpecialists.ts';

type Props = {
  api: Api;
  config: ConfigEditorResponse;
  selected: string | null;
  onSelect: (slug: string | null) => void;
  dirty: { current: boolean };
  state: SharedSpecialistsState;
};

/** The form of the open shared specialist. */
function OpenForm(props: Props & { specialist: EditorSpecialist }) {
  const { t } = useTranslation();
  const { api, config, onSelect, dirty, state, specialist } = props;
  const { usage, usageError, notice, setNotice, loadUsage, refresh, onDirty } = state;
  const { catalog, catalogError } = state;
  return (
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
  );
}

/** The form of the open shared specialist, the form of a new one, or the empty screen. */
export function SharedSpecialistEditor(props: Props) {
  const { t } = useTranslation();
  const { api, config, selected, onSelect, dirty, state } = props;
  const { catalog, catalogError, setNotice, loadUsage, refresh, onDirty, specialist } = state;
  return (
    <>
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
        <OpenForm {...props} specialist={specialist} />
      ) : (
        <Empty icon={<Users />} title={t('specialists.empty')} />
      )}
    </>
  );
}
