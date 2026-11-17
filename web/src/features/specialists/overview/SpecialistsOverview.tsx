import { useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { EditorChain, EditorSpecialist } from '../../../shared/api/types.ts';
import type { Grouped } from '../../../shared/lib/catalog/projectRows.ts';
import { specialistName } from '../../../shared/lib/catalog/specialists.ts';
import { useMediaQuery } from '../../../shared/lib/browser/media.ts';
import { SplitPage } from '../../../shared/ui/layout/EntryList.tsx';
import { EntryOverview, type ProjectsMode } from '../../repositories/index.ts';
import { ChainsList } from '../chains/index.ts';
import { SpecialistsList } from '../page/SpecialistsList.tsx';
import type { SpecialistsSource } from '../page/useAllSpecialistsData.ts';
import { useSpecialistSearch } from '../page/useSpecialistSearch.tsx';
import { EntryPreview } from './EntryPreview.tsx';
import { Problems, UnknownProject } from './Problems.tsx';

/**
 * The tabs «Specialists» and «Chains» of the mode «All projects»: the entries grouped by slug with
 * their projects, and an overview instead of a form. Nothing here writes.
 */
export function SpecialistsOverview({
  api,
  data,
  selected,
  isChains,
  projects,
  onSelect,
  onOpenInProject,
}: {
  api: Api;
  data: SpecialistsSource;
  selected: string | null;
  isChains: boolean;
  projects: ProjectsMode;
  onSelect: (id: string | null, section?: string | null) => void;
  onOpenInProject?: ((path: string, entry: string, section?: string | null) => void) | undefined;
}) {
  const { view } = data;
  const columns = useMediaQuery('(min-width: 1280px)');
  const wide = useMediaQuery('(min-width: 768px)');
  const search = useSpecialistSearch(view, columns);
  const slugs = new Set(projects.registry.filter((e) => e.enabled).map((e) => e.slug));
  const unknown = projects.project !== null && !slugs.has(projects.project);
  const section = isChains ? 'chains' : null;
  const side = (
    <>
      <Problems data={data} />
      {isChains ? (
        <ChainsList
          readOnly
          chains={view?.chains ?? []}
          loaded={view !== null}
          selected={selected}
          onSelect={(slug) => onSelect(slug, 'chains')}
        />
      ) : (
        <SpecialistsList
          readOnly
          specialists={search.shown}
          loaded={view !== null}
          selected={selected}
          narrowed={search.count > 0}
          filtersControl={search.button(wide)}
          onReset={search.reset}
          onSelect={(slug) => onSelect(slug, null)}
        />
      )}
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      {unknown ? <UnknownProject /> : null}
      <SplitPage {...(isChains ? {} : search.column)} side={side}>
        <Detail
          key={`${isChains}:${selected}`}
          api={api}
          data={data}
          selected={selected}
          isChains={isChains}
          highlight={projects.project}
          onOpen={(path) => onOpenInProject?.(path, selected ?? '', section)}
        />
      </SplitPage>
    </div>
  );
}

/** The overview of the open specialist or chain, with the preview of one project. */
function Detail({
  api,
  data,
  selected,
  isChains,
  highlight,
  onOpen,
}: {
  api: Api;
  data: SpecialistsSource;
  selected: string | null;
  isChains: boolean;
  highlight: string | null;
  onOpen: (path: string) => void;
}) {
  const { view } = data;
  const [chosen, setChosen] = useState<string | null>(null);
  if (view === null) return null;
  const rows = (isChains ? view.chains : view.specialists) as Grouped<
    EditorSpecialist | EditorChain
  >[];
  const row = rows.find((candidate) => candidate.slug === selected);
  if (!row) return null;
  const slugs = row.presences.map((presence) => presence.project.slug);
  const active =
    chosen !== null && slugs.includes(chosen)
      ? chosen
      : highlight !== null && slugs.includes(highlight)
        ? highlight
        : (slugs[0] ?? null);
  const source = data.projects?.find((entry) => entry.project.slug === active);
  const preview =
    source?.view && active !== null ? (
      <EntryPreview
        key={`${active}:${row.slug}`}
        api={api}
        data={data}
        project={source.project}
        view={source.view}
        slug={row.slug}
        isChains={isChains}
      />
    ) : null;
  return (
    <EntryOverview
      title={
        isChains
          ? String((row as EditorChain).raw.name || row.slug)
          : specialistName(row as EditorSpecialist)
      }
      id={row.slug}
      row={row}
      highlight={highlight}
      active={active}
      onPreview={setChosen}
      preview={preview}
      onOpen={onOpen}
    />
  );
}
