import type {
  ConfigEditorResponse,
  ProvidersView,
  RepositoryView,
} from '../../../shared/api/types.ts';
import { projectRef } from '../../../shared/lib/catalog/projectRows.ts';
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
    project: null,
  }));
}

/**
 * The rows of the mode «All projects»: the shared providers once (from the first project that has
 * them), the project ones of every project with the project's mark. Sorted by slug.
 */
export function rowsOfAll(
  entries: { project: RepositoryView; view: ProvidersView }[],
): ProviderRow[] {
  const seen = new Set<string>();
  const rows: ProviderRow[] = [];
  for (const { project, view } of entries) {
    for (const provider of view.providers) {
      if (provider.level === 'global') {
        if (seen.has(provider.slug)) continue;
        seen.add(provider.slug);
        rows.push({ key: `*:${provider.slug}`, provider, overrides: false, project: null });
      } else {
        rows.push({
          key: `${project.slug}:${provider.slug}`,
          provider,
          overrides: false,
          project: projectRef(project),
        });
      }
    }
  }
  return rows.sort((a, b) =>
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
