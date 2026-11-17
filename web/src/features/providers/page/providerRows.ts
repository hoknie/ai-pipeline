import type {
  ConfigEditorResponse,
  ProvidersView,
  RepositoryView,
} from '../../../shared/api/types.ts';
import { groupRows, projectRef } from '../../../shared/lib/catalog/projectRows.ts';
import type { ProviderRow } from '../list/ProvidersList.tsx';

const overrides = (editor: ConfigEditorResponse | null | undefined, slug: string) =>
  editor?.providers.find((item) => item.slug === slug)?.level === 'project_over_global';

/** The rows of one project: its providers, a project provider that overrides a shared one marked. */
export function rowsOfProject(
  view: ProvidersView,
  editor: ConfigEditorResponse | null,
): ProviderRow[] {
  return view.providers.map((provider) => ({
    key: provider.slug,
    provider,
    overrides: provider.level === 'project' && overrides(editor, provider.slug),
  }));
}

/**
 * The rows of the mode «All projects»: one row per provider slug with the projects that have it
 * (the shared provider's fields when there is one). Sorted by slug.
 */
export function rowsOfAll(
  entries: { project: RepositoryView; view: ProvidersView }[],
): ProviderRow[] {
  const grouped = groupRows(
    entries.map(({ project, view }) => ({
      project: projectRef(project),
      entries: view.providers,
    })),
    (provider) => provider.slug,
  );
  return grouped
    .map((provider) => ({
      key: provider.slug,
      provider,
      overrides: false,
      group: provider,
    }))
    .sort((a, b) =>
      a.provider.slug < b.provider.slug ? -1 : a.provider.slug > b.provider.slug ? 1 : 0,
    );
}

/** The view of the shared level only: its roles and providers, with the matrix of those. */
export function sharedLevel(view: ProvidersView): ProvidersView {
  const roles = view.roles.filter((role) => role.level === 'global');
  const providers = view.providers.filter((provider) => provider.level === 'global');
  return {
    ...view,
    roles,
    providers,
    matrix: view.matrix.filter(
      (cell) =>
        roles.some((role) => role.slug === cell.role) &&
        providers.some((provider) => provider.slug === cell.provider),
    ),
  };
}
