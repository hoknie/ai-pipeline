import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ProvidersView, RepositoryView, RunView } from '../../../shared/api/types.ts';
import { useMediaQuery } from '../../../shared/lib/browser/media.ts';
import { enabledProjects } from '../../../shared/lib/catalog/projectRows.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { ConfigErrors } from '../../../shared/ui/layout/EntryList.tsx';
import { ProvidersList, type ProviderRow } from '../list/ProvidersList.tsx';
import { ProvidersMatrix } from '../matrix/ProvidersMatrix.tsx';
import { RolesTab } from '../roles/RolesTab.tsx';
import { EmptyProviders } from './EmptyProviders.tsx';
import { ProviderFormPage } from './ProviderFormPage.tsx';
import { ProvidersHeader } from './ProvidersHeader.tsx';
import { rowsOfAll, rowsOfProject, sharedLevel } from './providerRows.ts';
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
  /** `new`, the slug of a provider, or null for the tabs. */
  selected: string | null;
  /** `roles` for the tab «Roles». */
  section: string | null;
  /** The preset of `#providers/new`. */
  preset: string | null;
  /** The slug of the project of a project provider (`?project=`). */
  project: string | null;
  projects?: ProvidersProjects | undefined;
  onSelect: (
    run: string | null,
    section?: string | null,
    preset?: string | null,
    project?: string | null,
  ) => void;
}

/** The rows of the list: one project's providers, or in «All projects» the shared ones and each project's. */
function useRows(props: ProvidersPageProps) {
  const { api, repository, runs, projects } = props;
  const own = useProviderRegistry(api, repository, runs);
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

/** The tabs «Providers» (list and matrix) and «Roles», and the form of a provider. */
export function ProvidersPage(props: ProvidersPageProps) {
  const { api, repository, selected, section, projects, onSelect } = props;
  const { t } = useTranslation();
  const narrow = !useMediaQuery('(min-width: 768px)');
  const data = useRows(props);
  const { own, editor, rows } = data;
  const onRoles = section === 'roles';
  const open = (row: ProviderRow) =>
    onSelect(row.provider.slug, null, null, row.project?.slug ?? null);
  const current = useListHotkeys(rows, selected === null && !onRoles, open);

  if (selected !== null) {
    const owner =
      projects?.registry.find((entry) => entry.slug === props.project)?.path ?? repository;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ProviderFormPage
          key={`${owner ?? ''}:${selected}`}
          api={owner === repository ? api : api.forRepository(owner)}
          repository={owner}
          slug={selected === 'new' ? null : selected}
          preset={props.preset}
          onLeave={() => onSelect(null)}
        />
      </div>
    );
  }
  const view = own.view;
  const shared = projects && view ? sharedLevel(view) : view;
  const broken = !projects && view !== null && view.errors.length > 0;
  const ready = data.loaded && shared !== null && !broken;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProvidersHeader onRoles={onRoles} onSelect={onSelect} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Problems
          failures={[...(own.failure ? [own.failure] : []), ...data.failures]}
          view={broken ? view : null}
        />
        {!data.loaded && !own.failure ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('providers.loading')}
          </p>
        ) : null}
        {ready && onRoles ? (
          <RolesTab
            api={api}
            repository={repository}
            view={shared}
            editor={editor}
            allProjects={projects !== undefined}
          />
        ) : null}
        {ready && !onRoles && rows.length === 0 ? (
          <EmptyProviders onCreate={(preset) => onSelect('new', null, preset)} />
        ) : null}
        {ready && !onRoles && rows.length > 0 ? (
          <>
            <ProvidersList rows={rows} selected={current} narrow={narrow} onOpen={open} />
            {projects ? (
              <p className="text-xs text-muted-foreground">{t('providers.allProjectsHint')}</p>
            ) : null}
            <ProvidersMatrix
              api={api}
              repository={repository}
              view={shared}
              editor={editor}
              narrow={narrow}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
