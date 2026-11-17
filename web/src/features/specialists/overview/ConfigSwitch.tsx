import { ExternalLink, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse, EntryLevel } from '../../../shared/api/types.ts';
import type { Grouped, ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';

/** The value of the choice of the shared entry. */
export const SHARED_CHOICE = '*shared';

/**
 * One configuration of an entry to look at: the shared one or a project's own. `project` is
 * where it is read and opened; for the shared one, a project that uses it as it is when one does.
 */
export interface ConfigChoice {
  value: string;
  project: ProjectRef;
  level: EntryLevel;
}

type Row = Grouped<{ level: EntryLevel }>;

/**
 * The shared entry first (when there is one), then the projects with their own entry: projects
 * that use the shared entry as it is are not choices of their own.
 */
export function configChoices(row: Row, highlight: string | null): ConfigChoice[] {
  const choices: ConfigChoice[] = [];
  if (row.presences.some((p) => p.entry.level !== 'project')) {
    const users = row.presences.filter((p) => p.entry.level === 'global');
    const host = users.find((p) => p.project.slug === highlight) ?? users[0] ?? row.presences[0]!;
    choices.push({ value: SHARED_CHOICE, project: host.project, level: 'global' });
  }
  for (const { project, entry } of row.presences) {
    if (entry.level !== 'global')
      choices.push({ value: project.slug, project, level: entry.level });
  }
  return choices;
}

/** The choice shown at first: the project of the address, the shared entry it uses, else the first. */
export function initialChoice(
  choices: readonly ConfigChoice[],
  row: Row,
  highlight: string | null,
) {
  const own = choices.find((choice) => choice.value === highlight);
  if (own) return own;
  const usesShared = row.presences.some(
    (p) => p.project.slug === highlight && p.entry.level === 'global',
  );
  const shared = choices.find((choice) => choice.value === SHARED_CHOICE);
  return (usesShared ? shared : undefined) ?? choices[0] ?? null;
}

/** The view of a project with the entry replaced by its shared file, for the shared choice. */
export function sharedView(
  view: ConfigEditorResponse,
  slug: string,
  isChains: boolean,
): ConfigEditorResponse {
  const toShared = <T extends { slug: string; level: EntryLevel; sources: EntrySourcesLike }>(
    entry: T,
  ): T => {
    const shared = entry.sources.global;
    if (entry.slug !== slug || entry.level === 'global' || !shared) return entry;
    return {
      ...entry,
      level: 'global',
      file: shared.file,
      revision: shared.revision,
      raw: shared.raw,
      sources: { global: shared },
    };
  };
  return isChains
    ? { ...view, chains: view.chains.map(toShared) }
    : { ...view, specialists: view.specialists.map(toShared) };
}

type EntrySourcesLike = {
  global?: { file: string; revision: string; raw: Record<string, unknown> };
};

/** A compact switch between the shared configuration and the projects' own, with «Open in project». */
export function ConfigSwitch({
  choices,
  active,
  onChoose,
  onOpen,
}: {
  choices: readonly ConfigChoice[];
  active: ConfigChoice;
  onChoose: (value: string) => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const levelLabel = (level: EntryLevel) =>
    level === 'project_over_global' ? t('projectOverview.overrides') : t('projectOverview.project');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        value={active.value}
        onValueChange={(value) => {
          if (value) onChoose(value);
        }}
        aria-label={t('projectOverview.choose')}
        className="flex-wrap"
      >
        {choices.map((choice) => (
          <ToggleGroupItem
            key={choice.value}
            value={choice.value}
            data-config-choice={choice.value}
            title={choice.value === SHARED_CHOICE ? undefined : levelLabel(choice.level)}
          >
            {choice.value === SHARED_CHOICE ? (
              <>
                <Globe aria-hidden className="size-3" />
                {t('projectOverview.shared')}
              </>
            ) : (
              <>
                <ProjectDot color={choice.project.color} />
                {choice.project.label}
              </>
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Button
        variant="ghost"
        size="sm"
        title={active.project.label}
        onClick={() => onOpen(active.project.path)}
      >
        <ExternalLink />
        {t('projectOverview.open')}
        <span className="sr-only"> {active.project.label}</span>
      </Button>
    </div>
  );
}
