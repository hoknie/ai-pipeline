import { useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelCatalogProvider } from '../../shared/lib/catalog/models.tsx';
import type { Api } from '../../shared/api/api.ts';
import type { RepositoryView } from '../../shared/api/types.ts';
import { enabledProjects, rowKey, splitRowKey } from '../../shared/lib/catalog/projectRows.ts';
import { useNewEntry, type ProjectsMode } from '../repositories/index.ts';
import { useMediaQuery } from '../../shared/lib/browser/media.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { ConfigErrors, SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { LinkTabs } from '../../shared/ui/layout/LinkTabs.tsx';
import { ChainsList, ChainsPane, NEW_CHAIN } from './chains/index.ts';
import { SpecialistImportDialog } from './importing/SpecialistImportDialog.tsx';
import { NEW_ID, SpecialistPane } from './page/SpecialistPane.tsx';
import { SpecialistsList } from './page/SpecialistsList.tsx';
import { useLeaveGuard } from './page/useLeaveGuard.ts';
import { useSpecialistSearch } from './page/useSpecialistSearch.tsx';
import { useAllSpecialistsData, type SpecialistsSource } from './page/useAllSpecialistsData.ts';
import { useSpecialistsData } from './page/useSpecialistsData.ts';

export { NEW_ID, NEW_CHAIN };
export type { ProjectsMode };
export { LEVEL_KEYS } from './page/SpecialistsList.tsx';

/** The failures of loading and the errors of the configuration above a list. */
function Problems({ data }: { data: SpecialistsSource }) {
  const { view, failure, failures } = data;
  return (
    <>
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {failures.length > 0 && view ? (
        <Alert variant="destructive">{failures.join('\n')}</Alert>
      ) : null}
      {view ? <ConfigErrors errors={view.errors} /> : null}
    </>
  );
}

type Select = (id: string | null, section?: string | null, project?: string | null) => void;

function SpecialistsBody({
  data,
  selected,
  projects,
  dirty,
  notice,
  setNotice,
  go,
  onSelect,
}: {
  data: SpecialistsSource;
  selected: string | null;
  projects: ProjectsMode | undefined;
  dirty: RefObject<boolean>;
  notice: string | null;
  setNotice: (n: string | null) => void;
  go: (id: string | null, extra?: string | null) => Promise<void>;
  onSelect: Select;
}) {
  const { t } = useTranslation();
  const { view, load } = data;
  const [importing, setImporting] = useState<string | null | false>(false);
  const columns = useMediaQuery('(min-width: 1280px)');
  const wide = useMediaQuery('(min-width: 768px)');
  const { column, button, shown, count, reset } = useSpecialistSearch(view, columns);
  const newEntry = useNewEntry(projects, (project) => void go(rowKey(project, NEW_ID), null));
  const importer = useNewEntry(projects, (project) => setImporting(project));
  const context = data.contextOf(importing === false ? selected : rowKey(importing, ''));
  const open = splitRowKey(selected ?? '');
  const pane = data.contextOf(selected);

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
            onNew={newEntry.ask}
            onImport={() => (projects ? importer.ask() : setImporting(null))}
            onReset={reset}
            onSelect={(key) => void go(key, null)}
          />
        </>
      }
    >
      <SpecialistPane
        {...data}
        api={pane.api}
        view={pane.view}
        selected={open.id === '' ? null : open.id}
        notice={notice}
        dirty={dirty}
        onSelect={(id) => onSelect(id, null, open.project)}
        onNotice={setNotice}
      />
      {newEntry.dialog}
      {importer.dialog}
      {context.view && context.view.repository && importing !== false ? (
        <SpecialistImportDialog
          api={context.api}
          repository={context.view.repository}
          specialists={context.view.specialists}
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
  projects,
  dirty,
  go,
  onSelect,
}: {
  data: SpecialistsSource;
  selected: string | null;
  projects: ProjectsMode | undefined;
  dirty: RefObject<boolean>;
  go: (id: string | null, extra?: string | null) => Promise<void>;
  onSelect: Select;
}) {
  const { view, load } = data;
  const newEntry = useNewEntry(
    projects,
    (project) => void go(rowKey(project, NEW_CHAIN), 'chains'),
  );
  const open = splitRowKey(selected ?? '');
  const pane = data.contextOf(selected);
  return (
    <SplitPage
      side={
        <>
          <Problems data={data} />
          <ChainsList
            chains={view?.chains ?? []}
            loaded={view !== null}
            selected={selected}
            onNew={newEntry.ask}
            onSelect={(key) => void go(key, 'chains')}
          />
        </>
      }
    >
      <ChainsPane
        api={pane.api}
        view={pane.view}
        failure={data.failure}
        selected={open.id === '' ? null : open.id}
        dirty={dirty}
        load={load}
        onSelect={(slug) => onSelect(slug, 'chains', open.project)}
      />
      {newEntry.dialog}
    </SplitPage>
  );
}

/** The tabs «Specialists» and «Chains»; a click asks first when the open form has edits. */
function UnknownProject() {
  const { t } = useTranslation();
  return (
    <div className="px-4">
      <Alert variant="destructive" role="alert">
        {t('specialists.projectNotFound')}
      </Alert>
    </div>
  );
}

function useSpecialistTabs(
  isChains: boolean,
  go: (id: string | null, extra?: string | null) => Promise<void>,
) {
  const { t } = useTranslation();
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

  return tabs;
}

function SpecialistsScreen({
  api,
  data,
  selected,
  section,
  projects,
  onSelect,
  dirty: sharedDirty,
}: {
  api: Api;
  data: SpecialistsSource;
  selected: string | null;
  section: string | null;
  projects: ProjectsMode | undefined;
  onSelect: Select;
  dirty?: RefObject<boolean> | undefined;
}) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const ownDirty = useRef(false);
  const dirty = sharedDirty ?? ownDirty;
  const isChains = section === 'chains';
  const slugs = new Set((projects?.registry ?? []).filter((e) => e.enabled).map((e) => e.slug));
  const unknown = projects?.project != null && !slugs.has(projects.project);
  const key = selected === null || unknown ? null : rowKey(projects?.project, selected);
  // a key goes to the route as the id of the entry and the slug of its project
  const choose = (next: string | null, extra?: string | null) => {
    const { project, id } = splitRowKey(next ?? '');
    onSelect(next === null ? null : id, extra, project);
  };
  const go = useLeaveGuard(key, dirty, choose, () => setNotice(null));

  const tabs = useSpecialistTabs(isChains, go);

  return (
    <ModelCatalogProvider api={api}>
      <div className="flex flex-col gap-3">
        <div className="px-4 pt-3">
          <LinkTabs label={t('specialists.tabs.label')} tabs={tabs} />
        </div>
        {unknown ? <UnknownProject /> : null}
        {isChains ? (
          <ChainsBody
            data={data}
            selected={key}
            projects={projects}
            dirty={dirty}
            go={go}
            onSelect={onSelect}
          />
        ) : (
          <SpecialistsBody
            data={data}
            selected={key}
            projects={projects}
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
  dirty?: RefObject<boolean>;
  /** Set in the mode «All projects»: the list merges the projects. */
  projects?: ProjectsMode;
};

function SingleProject(props: PageProps) {
  const data = useSpecialistsData(props.api);
  const source: SpecialistsSource = {
    ...data,
    failures: [],
    contextOf: () => ({ api: props.api, view: data.view }),
  };
  return (
    <SpecialistsScreen
      {...props}
      data={source}
      section={props.section ?? null}
      projects={undefined}
    />
  );
}

function AllProjects(props: PageProps & { projects: ProjectsMode }) {
  const single = useSpecialistsData(props.api);
  const list = useMemo(() => enabledProjects(props.projects.registry), [props.projects.registry]);
  const data = useAllSpecialistsData(props.api, list, single);
  return <SpecialistsScreen {...props} data={data} section={props.section ?? null} />;
}

export default function SpecialistsPage(props: PageProps) {
  return props.projects ? (
    <AllProjects {...props} projects={props.projects} />
  ) : (
    <SingleProject {...props} />
  );
}
