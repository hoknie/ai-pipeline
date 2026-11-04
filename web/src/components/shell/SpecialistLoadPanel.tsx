import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../repositories.ts';
import {
  loadSections,
  machineLoad,
  type LoadEntry,
  type RepositoryUse,
} from '../../specialistLoad.ts';
import type { RunView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { StatusBadge } from '../StatusBadge.tsx';

function Entries({
  entries,
  onOpen,
}: {
  entries: LoadEntry[];
  onOpen: (entry: LoadEntry) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <li
          key={`${entry.runId}/${entry.group}/${entry.status}`}
          className="flex min-w-0 flex-wrap items-baseline gap-x-2"
        >
          <Button
            variant="link"
            size="sm"
            className="h-auto min-w-0 p-0 text-left whitespace-normal"
            onClick={() => onOpen(entry)}
          >
            {entry.title}
          </Button>
          <StatusBadge status={entry.status} />
          <span className="text-muted-foreground">
            {entry.stepName} · {entry.runTitle}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Counts({ running, waiting }: { running: number; waiting: number }) {
  const { t } = useTranslation();
  return (
    <span className="text-muted-foreground">
      {[
        ...(running > 0 ? [t('specialistLoad.running', { n: running })] : []),
        ...(waiting > 0 ? [t('specialistLoad.waiting', { n: waiting })] : []),
      ].join(' · ')}
    </span>
  );
}

function Repository({ use, onOpen }: { use: RepositoryUse; onOpen: (entry: LoadEntry) => void }) {
  return (
    <div className="flex flex-col gap-0.5 pl-3">
      <div className="flex gap-2" title={use.repository}>
        <span className="font-medium">{repositoryLabel(use.repository)}</span>
        <Counts running={use.running.length} waiting={use.waiting.length} />
      </div>
      <div className="pl-3">
        <Entries entries={[...use.running, ...use.waiting]} onOpen={onOpen} />
      </div>
    </div>
  );
}

/** The blocks of the specialists: global limits and the projects, with who runs and who waits. */
export function SpecialistLoadPanel({
  runs,
  selected,
  onOpenGroup,
}: {
  runs: RunView[];
  /** The repository selected in the panel; its rows come first. */
  selected: string | null;
  onOpenGroup: (entry: LoadEntry) => void;
}) {
  const { t } = useTranslation();
  const sections = useMemo(() => loadSections(machineLoad(runs), selected), [runs, selected]);
  const idle = sections.running === 0 && sections.waiting === 0;
  const limit = (max: number | null) =>
    max === null ? '' : ` ${t('specialistLoad.limit', { max })}`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {idle ? <p className="text-muted-foreground">{t('specialistLoad.none')}</p> : null}
      {sections.global.length > 0 ? (
        <section aria-label={t('specialistLoad.global')} className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('specialistLoad.global')}</h3>
          {sections.global.map((section) => (
            <div key={section.specialist} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap gap-2">
                <span className="font-medium" title={section.specialist}>
                  {section.name}
                </span>
                <span className="text-muted-foreground">
                  {section.max === null
                    ? t('topology.busyUnlimited', { n: section.running })
                    : t('topology.busy', { n: section.running, max: section.max })}
                  {section.waiting > 0
                    ? ` · ${t('specialistLoad.waiting', { n: section.waiting })}`
                    : ''}
                </span>
              </div>
              {section.repositories.map((use) => (
                <Repository key={use.repository} use={use} onOpen={onOpenGroup} />
              ))}
            </div>
          ))}
        </section>
      ) : null}
      {sections.project.length > 0 ? (
        <section aria-label={t('specialistLoad.project')} className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('specialistLoad.project')}</h3>
          {sections.project.map((section) => (
            <div key={section.repository} className="flex flex-col gap-1">
              <div className="flex gap-2" title={section.repository}>
                <span className="font-medium">{repositoryLabel(section.repository)}</span>
                <Counts running={section.running} waiting={section.waiting} />
              </div>
              {section.specialists.map((item) => (
                <div key={item.specialist} className="flex flex-col gap-0.5 pl-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="font-medium" title={item.specialist}>
                      {item.name}
                      {limit(item.max)}
                    </span>
                    <Counts running={item.running.length} waiting={item.waiting.length} />
                    {item.totalRunning > item.running.length ? (
                      <span className="text-muted-foreground">
                        {t('specialistLoad.machine', { n: item.totalRunning })}
                      </span>
                    ) : null}
                  </div>
                  <div className="pl-3">
                    <Entries entries={[...item.running, ...item.waiting]} onOpen={onOpenGroup} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
