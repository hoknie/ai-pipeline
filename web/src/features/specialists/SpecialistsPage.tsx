import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { ConfigErrors, SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { SpecialistImportDialog } from './importing/SpecialistImportDialog.tsx';
import { NEW_ID, SpecialistPane } from './page/SpecialistPane.tsx';
import { SpecialistsFilterControl } from './page/SpecialistsFilterControl.tsx';
import { SpecialistsList } from './page/SpecialistsList.tsx';
import { useLeaveGuard } from './page/useLeaveGuard.ts';
import { useSpecialistSearch } from './page/useSpecialistSearch.tsx';
import { useSpecialistsData } from './page/useSpecialistsData.ts';

export { NEW_ID };
export { LEVEL_KEYS } from './page/SpecialistsList.tsx';

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
  const data = useSpecialistsData(api);
  const { view, load } = data;
  const [notice, setNotice] = useState<string | null>(null);
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const [importing, setImporting] = useState(false);
  const columns = useMediaQuery('(min-width: 1280px)');
  const wide = useMediaQuery('(min-width: 768px)');
  const { panel, shown, count, reset } = useSpecialistSearch(view);
  const go = useLeaveGuard(selected, dirty, onSelect, () => setNotice(null));

  return (
    <SplitPage
      filters={columns ? panel : null}
      filtersLabel={t('specialists.filters.button')}
      side={
        <>
          {data.failure ? <Alert variant="destructive">{data.failure}</Alert> : null}
          {view ? <ConfigErrors errors={view.errors} /> : null}
          <SpecialistsList
            specialists={shown}
            loaded={view !== null}
            selected={selected}
            narrowed={count > 0}
            filtersControl={
              !view || columns ? null : (
                <SpecialistsFilterControl count={count} wide={wide} panel={panel} />
              )
            }
            onNew={() => void go(NEW_ID)}
            onImport={() => setImporting(true)}
            onReset={reset}
            onSelect={(id) => void go(id)}
          />
        </>
      }
    >
      <SpecialistPane
        {...data}
        api={api}
        selected={selected}
        notice={notice}
        dirty={dirty}
        onSelect={onSelect}
        onNotice={setNotice}
      />
      {view && view.repository ? (
        <SpecialistImportDialog
          api={api}
          repository={view.repository}
          specialists={view.specialists}
          open={importing}
          onOpenChange={setImporting}
          onImported={async (slugs) => {
            await load();
            notifySuccess(t('specialists.import.done', { total: slugs.length }));
          }}
        />
      ) : null}
    </SplitPage>
  );
}
