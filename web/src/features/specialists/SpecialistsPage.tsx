import { useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelCatalogProvider } from '../../shared/lib/catalog/models.tsx';
import type { Api } from '../../shared/api/api.ts';
import type { RepositoryView } from '../../shared/api/types.ts';
import { enabledProjects } from '../../shared/lib/catalog/projectRows.ts';
import type { ProjectsMode } from '../repositories/index.ts';
import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import { SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { ChainsList, ChainsPane, NEW_CHAIN } from './chains/index.ts';
import { SpecialistImportDialog } from './importing/SpecialistImportDialog.tsx';
import { NEW_ID, SpecialistPane } from './page/SpecialistPane.tsx';
import { SpecialistsList } from './page/SpecialistsList.tsx';
import { useLeaveGuard } from './page/useLeaveGuard.ts';
import { useSpecialistSearch } from './page/useSpecialistSearch.tsx';
import { Problems } from './overview/Problems.tsx';
import { SpecialistsOverview } from './overview/SpecialistsOverview.tsx';
import { useAllSpecialistsData, type SpecialistsSource } from './page/useAllSpecialistsData.ts';
import { useSpecialistsData } from './page/useSpecialistsData.ts';

export { NEW_ID, NEW_CHAIN };
export type { ProjectsMode };
export { LEVEL_KEYS } from './page/SpecialistsList.tsx';

type Select = (id: string | null, section?: string | null, project?: string | null) => void;

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
  data: SpecialistsSource;
  selected: string | null;
  dirty: RefObject<boolean>;
  notice: string | null;
  setNotice: (n: string | null) => void;
  go: (id: string | null, extra?: string | null) => Promise<void>;
  onSelect: Select;
}) {
  const { t } = useTranslation();
  const { view, load } = data;
  const [importing, setImporting] = useState(false);
  const columns = useMediaQuery('(min-width: 1280px)');
  const wide = useMediaQuery('(min-width: 768px)');
  const { column, button, shown, count, reset } = useSpecialistSearch(view, columns);

  return (
    <SplitPage
      {...column}
      side={
        <>
          <Problems data={data} />
          <SpecialistsList
            specialists={shown}
            loaded={view !== null}
            selected={selected}
            narrowed={count > 0}
            filtersControl={button(wide)}
            onNew={() => void go(NEW_ID, null)}
            onImport={() => setImporting(true)}
            onReset={reset}
            onSelect={(key) => void go(key, null)}
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
      {view && view.repository && importing ? (
        <SpecialistImportDialog
          api={api}
          repository={view.repository}
          specialists={view.specialists}
          open
          onOpenChange={() => setImporting(false)}
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
  data,
  selected,
  dirty,
  go,
  onSelect,
  onProviders,
  api,
}: {
  api: Api;
  data: SpecialistsSource;
  selected: string | null;
  dirty: RefObject<boolean>;
  go: (id: string | null, extra?: string | null) => Promise<void>;
  onSelect: Select;
  onProviders?: (() => void) | undefined;
}) {
  const { view, load } = data;
  return (
    <SplitPage
      side={
        <>
          <Problems data={data} />
          <ChainsList
            chains={view?.chains ?? []}
            loaded={view !== null}
            selected={selected}
            onNew={() => void go(NEW_CHAIN, 'chains')}
            onSelect={(key) => void go(key, 'chains')}
            {...(onProviders ? { onProviders } : {})}
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

function SpecialistsScreen({
  api,
  data,
  selected,
  section,
  onSelect,
  onProviders,
  dirty: sharedDirty,
}: {
  api: Api;
  data: SpecialistsSource;
  selected: string | null;
  section: string | null;
  onSelect: Select;
  onProviders?: (() => void) | undefined;
  dirty?: RefObject<boolean> | undefined;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const go = useLeaveGuard(
    selected,
    dirty,
    (next, extra) => onSelect(next, extra),
    () => setNotice(null),
  );

  return (
    <ModelCatalogProvider api={api}>
      <div className="flex flex-col gap-3">
        {section === 'chains' ? (
          <ChainsBody
            api={api}
            data={data}
            selected={selected}
            dirty={dirty}
            go={go}
            onSelect={onSelect}
            onProviders={onProviders}
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
    </ModelCatalogProvider>
  );
}

type PageProps = {
  api: Api;
  selected: string | null;
  section?: string | null;
  onSelect: Select;
  /** Opens the tab «Providers» of the window (a hint of an empty list of chains). */
  onProviders?: () => void;
  dirty?: RefObject<boolean>;
  /** Set in the mode «All projects»: the lists group the projects and only show them. */
  projects?: ProjectsMode;
  /** Opens an entry in the form of a project (leaves the mode). */
  onOpenInProject?: ((path: string, entry: string, section?: string | null) => void) | undefined;
};

function SingleProject(props: PageProps) {
  const data = useSpecialistsData(props.api);
  const source: SpecialistsSource = { ...data, failures: [] };
  return <SpecialistsScreen {...props} data={source} section={props.section ?? null} />;
}

function AllProjects(props: PageProps & { projects: ProjectsMode }) {
  const single = useSpecialistsData(props.api);
  const list = useMemo(() => enabledProjects(props.projects.registry), [props.projects.registry]);
  const data = useAllSpecialistsData(props.api, list, single);
  return (
    <SpecialistsOverview
      api={props.api}
      data={data}
      selected={props.selected}
      isChains={props.section === 'chains'}
      projects={props.projects}
      onSelect={(id, section) => props.onSelect(id, section, null)}
      onOpenInProject={props.onOpenInProject}
    />
  );
}

export default function SpecialistsPage(props: PageProps) {
  return props.projects ? (
    <AllProjects {...props} projects={props.projects} />
  ) : (
    <SingleProject {...props} />
  );
}
