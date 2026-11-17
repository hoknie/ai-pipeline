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
import { tagsOfSpecialist } from '../specialistTags.ts';
import { Problems, UnknownProject } from './Problems.tsx';

function describeSpecialist(entry: EditorSpecialist): string {
  const chain = (entry.raw.runtime_chain as string) ?? null;
  const runtime = chain
    ? `chain: ${chain}`
    : entry.effective
      ? `${entry.effective.runtime}${entry.effective.model ? ` · ${entry.effective.model}` : ''}`
      : '';
  const tags = tagsOfSpecialist(entry).map((tag) => tag.name);
  return [runtime, ...tags].filter(Boolean).join(' · ');
}

function describeChain(entry: EditorChain): string {
  const runtimes = Array.isArray(entry.raw.runtimes) ? entry.raw.runtimes : [];
  return runtimes
    .map((item) => String((item as { provider?: unknown }).provider ?? ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * The tabs «Specialists» and «Chains» of the mode «All projects»: the entries grouped by slug with
 * their projects, and an overview instead of a form. Nothing here writes.
 */
export function SpecialistsOverview({
  data,
  selected,
  isChains,
  projects,
  onSelect,
  onOpenInProject,
}: {
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
          view={view}
          selected={selected}
          isChains={isChains}
          highlight={projects.project}
          onOpen={(path) => onOpenInProject?.(path, selected ?? '', section)}
        />
      </SplitPage>
    </div>
  );
}

/** The overview of the open specialist or chain. */
function Detail({
  view,
  selected,
  isChains,
  highlight,
  onOpen,
}: {
  view: SpecialistsSource['view'];
  selected: string | null;
  isChains: boolean;
  highlight: string | null;
  onOpen: (path: string) => void;
}) {
  if (view === null) return null;
  const specialist = (view.specialists as Grouped<EditorSpecialist>[]).find(
    (row) => row.slug === selected,
  );
  const chain = (view.chains as Grouped<EditorChain>[]).find((row) => row.slug === selected);
  if (!isChains && specialist) {
    return (
      <EntryOverview
        title={specialistName(specialist)}
        id={specialist.slug}
        row={specialist}
        describe={describeSpecialist}
        highlight={highlight}
        onOpen={onOpen}
      />
    );
  }
  if (isChains && chain) {
    return (
      <EntryOverview
        title={String(chain.raw.name || chain.slug)}
        id={chain.slug}
        row={chain}
        describe={describeChain}
        highlight={highlight}
        onOpen={onOpen}
      />
    );
  }
  return null;
}
