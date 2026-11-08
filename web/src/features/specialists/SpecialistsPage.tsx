import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { ConfigErrors, SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import { ChainsList, ChainsPane, NEW_CHAIN } from './chains/index.ts';
import { SpecialistImportDialog } from './importing/SpecialistImportDialog.tsx';
import { NEW_ID, SpecialistPane } from './page/SpecialistPane.tsx';
import { SpecialistsFilterControl } from './page/SpecialistsFilterControl.tsx';
import { SpecialistsList } from './page/SpecialistsList.tsx';
import { useLeaveGuard } from './page/useLeaveGuard.ts';
import { useSpecialistSearch } from './page/useSpecialistSearch.tsx';
import { useSpecialistsData } from './page/useSpecialistsData.ts';

export { NEW_ID, NEW_CHAIN };
export { LEVEL_KEYS } from './page/SpecialistsList.tsx';

function SpecialistsBody({
  api,
  data,
  selected,
  dirty,
  notice,
  setNotice,
  go,
  onSelect,
}: {
  api: Api;
  data: ReturnType<typeof useSpecialistsData>;
  selected: string | null;
  dirty: RefObject<boolean>;
  notice: string | null;
  setNotice: (n: string | null) => void;
  go: (id: string | null, extra?: string | null) => Promise<void>;
  onSelect: (id: string | null, section?: string | null) => void;
}) {
  const { t } = useTranslation();
  const { view, load } = data;
  const [importing, setImporting] = useState(false);
  const columns = useMediaQuery('(min-width: 1280px)');
  const wide = useMediaQuery('(min-width: 768px)');
  const { panel, shown, count, reset } = useSpecialistSearch(view);

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
            onNew={() => void go(NEW_ID, null)}
            onImport={() => setImporting(true)}
            onReset={reset}
            onSelect={(id) => void go(id, null)}
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
        onSelect={(id) => onSelect(id, null)}
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

function ChainsBody({
  api,
  data,
  selected,
  dirty,
  go,
  onSelect,
}: {
  api: Api;
  data: ReturnType<typeof useSpecialistsData>;
  selected: string | null;
  dirty: RefObject<boolean>;
  go: (id: string | null, extra?: string | null) => Promise<void>;
  onSelect: (id: string | null, section?: string | null) => void;
}) {
  const { view, load } = data;
  return (
    <SplitPage
      side={
        <>
          {data.failure ? <Alert variant="destructive">{data.failure}</Alert> : null}
          {view ? <ConfigErrors errors={view.errors} /> : null}
          <ChainsList
            chains={view?.chains ?? []}
            loaded={view !== null}
            selected={selected}
            onNew={() => void go(NEW_CHAIN, 'chains')}
            onSelect={(slug) => void go(slug, 'chains')}
          />
        </>
      }
    >
      <ChainsPane
        api={api}
        view={view}
        failure={data.failure}
        selected={selected}
        dirty={dirty}
        load={load}
        onSelect={(slug) => onSelect(slug, 'chains')}
      />
    </SplitPage>
  );
}

export default function SpecialistsPage({
  api,
  selected,
  section = null,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  selected: string | null;
  section?: string | null;
  onSelect: (id: string | null, section?: string | null) => void;
  dirty?: RefObject<boolean>;
}) {
  const { t } = useTranslation();
  const data = useSpecialistsData(api);
  const [notice, setNotice] = useState<string | null>(null);
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const isChains = section === 'chains';
  const go = useLeaveGuard(selected, dirty, onSelect, () => setNotice(null));

  const tabs = [
    {
      key: 'specialists',
      label: t('specialists.tabs.specialists'),
      href: '#specialists',
      selected: !isChains,
      onClick: () => (isChains ? go(null, null) : Promise.resolve()),
    },
    {
      key: 'chains',
      label: t('specialists.tabs.chains'),
      href: '#specialists/chains',
      selected: isChains,
      onClick: () => (!isChains ? go(null, 'chains') : Promise.resolve()),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="px-4 pt-3">
        <LinkTabs label={t('specialists.tabs.label')} tabs={tabs} />
      </div>
      {isChains ? (
        <ChainsBody
          api={api}
          data={data}
          selected={selected}
          dirty={dirty}
          go={go}
          onSelect={onSelect}
        />
      ) : (
        <SpecialistsBody
          api={api}
          data={data}
          selected={selected}
          dirty={dirty}
          notice={notice}
          setNotice={setNotice}
          go={go}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
