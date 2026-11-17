import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ProvidersView, RepositoryView, RunView } from '../../../shared/api/types.ts';
import { useMediaQuery } from '../../../shared/lib/browser/media.ts';
import { enabledProjects } from '../../../shared/lib/catalog/projectRows.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { ConfigErrors, SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { type ProviderRow } from '../list/ProvidersList.tsx';
import { ProvidersSide } from '../list/ProvidersSide.tsx';
import { RolesTab } from '../roles/RolesTab.tsx';
import { ProviderPane } from './ProviderPane.tsx';
import { rowsOfAll, rowsOfProject, sharedLevel } from './providerRows.ts';
import { levelOf, ScopeContext } from './scope.ts';
import type { ProvidersScope } from './sources.ts';
import { useListHotkeys } from './useListHotkeys.ts';
import {
  useProviderEditor,
  useProviderRegistries,
  useProviderRegistry,
} from './useProviderRegistry.ts';

/** The mode «All projects»: the registry of the panel and the project the shared level is read through. */
export interface ProvidersProjects {
  registry: RepositoryView[];
  last: string | null;
}

export interface ProvidersPageProps {
  /** The API of the selected project. */
  api: Api;
  repository: string | null;
  runs: RunView[];
  /** `new`, the slug of a provider, or null for the matrix. */
  selected: string | null;
  /** `roles` for the tab «Roles». */
  section: string | null;
  /** The preset of `#providers/new`. */
  preset: string | null;
  /** The slug of the project of a project provider (`?project=`). */
  project: string | null;
  projects?: ProvidersProjects | undefined;
  /** `global`: the shared level alone, written to the shared files only. */
  scope?: ProvidersScope;
  /** The block «Where it is used» under the form of a provider. */
  usage?: ((slug: string) => ReactNode) | undefined;
  /** The address of the form of a new provider (for the empty state); the top bar's by default. */
  hrefOfNew?: ((preset: string | null) => string) | undefined;
  onSelect: (
    run: string | null,
    section?: string | null,
    preset?: string | null,
    project?: string | null,
  ) => void;
}

/** The rows of the list: one project's providers, or in «All projects» the shared ones and each project's. */
function useRows(props: ProvidersPageProps, scope: ProvidersScope) {
  const { api, repository, runs, projects } = props;
  const own = useProviderRegistry(api, repository, runs, levelOf(scope));
  const { editor } = useProviderEditor(api, repository);
  const paths = useMemo(
    () => (projects ? enabledProjects(projects.registry).map((entry) => entry.path) : []),
    [projects],
  );
  const others = useProviderRegistries(api, paths, runs);
  const rows = useMemo<ProviderRow[]>(() => {
    if (!projects) return own.view ? rowsOfProject(own.view, editor) : [];
    const entries = projects.registry.flatMap((entry) => {
      const view = others.views[paths.indexOf(entry.path)];
      return view ? [{ project: entry, view }] : [];
    });
    return rowsOfAll(entries);
  }, [projects, own.view, editor, others, paths]);
  const loaded = projects ? others.views.every((item) => item !== null) : own.view !== null;
  return { own, editor, rows, loaded, failures: others.failures };
}

function Problems({ failures, view }: { failures: string[]; view: ProvidersView | null }) {
  return (
    <>
      {failures.map((failure) => (
        <Alert key={failure} variant="destructive">
          {failure}
        </Alert>
      ))}
      {view ? <ConfigErrors errors={view.errors} /> : null}
    </>
  );
}

function LoadingNote() {
  const { t } = useTranslation();
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t('providers.loading')}
    </p>
  );
}

/** The key of the row of the open provider: the slug, or in «All projects» with its project. */
function openKey(rows: ProviderRow[], props: ProvidersPageProps): string | null {
  if (props.selected === null || props.selected === 'new') return null;
  const project = props.projects ? props.project : null;
  const found = rows.find(
    (row) => row.provider.slug === props.selected && (row.project?.slug ?? null) === project,
  );
  return found?.key ?? null;
}

/** The open provider; one that is not there (a stale address) leaves the tab without a chosen one. */
function knownSelection(props: ProvidersPageProps, rows: ProviderRow[], ready: boolean) {
  const { selected, projects } = props;
  const unknown =
    ready &&
    !projects &&
    selected !== null &&
    selected !== 'new' &&
    !rows.some((row) => row.provider.slug === selected);
  return unknown ? null : selected;
}

/** The tabs «Providers» (the list on the left, the form or the matrix on the right) and «Roles». */
export function ProvidersPage(props: ProvidersPageProps) {
  const scope = props.scope ?? 'project';
  return (
    <ScopeContext.Provider value={scope}>
      <ProvidersScreen {...props} scope={scope} />
    </ScopeContext.Provider>
  );
}

function ProvidersScreen(props: ProvidersPageProps & { scope: ProvidersScope }) {
  const { api, repository, section, projects, scope, onSelect } = props;
  const { t } = useTranslation();
  const narrow = !useMediaQuery('(min-width: 768px)');
  const data = useRows(props, scope);
  const { own, editor } = data;
  const onRoles = section === 'roles';
  const open = (row: ProviderRow) =>
    onSelect(row.provider.slug, null, null, row.project?.slug ?? null);
  const view = own.view;
  const shared = projects && view ? sharedLevel(view) : view;
  const broken = !projects && view !== null && view.errors.length > 0;
  const ready = data.loaded && shared !== null && !broken;
  // a configuration that does not assemble shows its errors instead of the list
  const rows = broken ? [] : data.rows;
  const current = useListHotkeys(rows, !onRoles, open);
  const selected = knownSelection(props, rows, ready);
  const problems = (
    <Problems
      failures={[...(own.failure ? [own.failure] : []), ...data.failures]}
      view={broken ? view : null}
    />
  );
  const loading = !data.loaded && !own.failure ? <LoadingNote /> : null;

  if (onRoles) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {problems}
        {loading}
        {ready ? (
          <RolesTab
            api={api}
            repository={repository}
            view={shared}
            editor={editor}
            allProjects={projects !== undefined}
            onProviders={() => onSelect(null)}
          />
        ) : null}
      </div>
    );
  }
  const owner =
    projects?.registry.find((entry) => entry.slug === props.project)?.path ?? repository;
  return (
    <SplitPage
      side={
        <>
          {problems}
          <ProvidersSide
            rows={rows}
            selected={openKey(rows, { ...props, selected }) ?? current}
            onOpen={open}
            onNew={() => onSelect('new')}
            note={projects ? t('providers.allProjectsHint') : null}
          />
        </>
      }
    >
      {loading}
      <ProviderPane
        api={api}
        repository={repository}
        owner={owner}
        selected={selected}
        preset={props.preset}
        usage={props.usage}
        hrefOfNew={props.hrefOfNew}
        ready={ready}
        rowCount={rows.length}
        view={shared}
        editor={editor}
        narrow={narrow}
        onSelect={onSelect}
      />
    </SplitPage>
  );
}
