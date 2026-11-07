import { useTranslation } from 'react-i18next';

import { runTitle, taskNumber } from '../../../shared/lib/format.ts';
import { LANGUAGES, useLanguage, type LanguageChoice } from '../../../shared/i18n/index.ts';
import { SECTIONS } from '../../sections.ts';
import type { Route } from '../../../shared/lib/nav/route.ts';
import { runStatusLabel } from '../../../shared/lib/status.ts';
import type { EditorSpecialist, EditorPipeline, RunView } from '../../../shared/api/types.ts';
import { CommandGroup, CommandItem } from '../../../shared/ui/overlays/command.tsx';
import { orderGroups } from '../../../shared/lib/order.ts';
import { PipelineBadge } from '../../../shared/ui/feedback/PipelineBadge.tsx';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';

export interface Entries {
  pipelines: EditorPipeline[];
  specialists: EditorSpecialist[];
}

type Go = (route: Route) => void;
type To = (view: Route['view'], run?: string | null) => Route;

export function SectionsGroup({ go, to }: { go: Go; to: To }) {
  const { t } = useTranslation();
  return (
    <CommandGroup heading={t('palette.sections')}>
      {SECTIONS.map(({ view, labelKey, icon: Icon }) => {
        const label = t(`nav.${labelKey}`);
        return (
          <CommandItem
            key={view}
            value={`${t('palette.section')} ${label}`}
            onSelect={() => go(to(view))}
          >
            <Icon />
            {label}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

export function RunsGroup({ go, runs }: { go: Go; runs: RunView[] }) {
  const { t } = useTranslation();
  return (
    <CommandGroup heading={t('palette.runs')}>
      {runs.map((run) => (
        <CommandItem
          key={run.id}
          value={`${t('palette.run')} ${taskNumber(run.number)} ${runTitle(run)} ${run.id} ${run.pipelineName} ${run.pipeline}`}
          onSelect={() => go({ view: 'runs', run: run.id, group: null, step: null, tab: null })}
        >
          <span className="truncate">
            <span className="font-mono text-xs text-muted-foreground">
              {taskNumber(run.number)}
            </span>{' '}
            {runTitle(run)}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <PipelineBadge id={run.pipeline} name={run.pipelineName} focusable={false} />
            <span className="text-xs text-muted-foreground">{runStatusLabel(run, t)}</span>
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function GroupsGroup({ go, run }: { go: Go; run: RunView }) {
  const { t } = useTranslation();
  return (
    <CommandGroup heading={t('palette.groups')}>
      {orderGroups(run.groups).map((group) => (
        <CommandItem
          key={group.slug}
          value={`${t('palette.group')} ${group.title} ${group.slug}`}
          onSelect={() =>
            go({ view: 'runs', run: run.id, group: group.slug, step: null, tab: null })
          }
        >
          {group.title}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function ConfigGroups({ go, to, entries }: { go: Go; to: To; entries: Entries }) {
  const { t } = useTranslation();
  return (
    <>
      {entries.pipelines.length > 0 ? (
        <CommandGroup heading={t('palette.pipelines')}>
          {entries.pipelines.map((pipeline) => {
            const name = rawName(pipeline.raw) ?? pipeline.id;
            return (
              <CommandItem
                key={pipeline.id}
                value={`${t('palette.pipelines')} ${name} ${pipeline.id}`}
                title={pipeline.id}
                onSelect={() => go(to('pipelines', pipeline.id))}
              >
                {name}
              </CommandItem>
            );
          })}
        </CommandGroup>
      ) : null}
      {entries.specialists.length > 0 ? (
        <CommandGroup heading={t('palette.specialists')}>
          {entries.specialists.map((specialist) => (
            <CommandItem
              key={specialist.slug}
              value={`${t('palette.specialist')} ${specialist.slug}`}
              onSelect={() => go(to('specialists', specialist.slug))}
            >
              {specialist.slug}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}

export function ActionsGroup({
  onNewTask,
  onShortcuts,
}: {
  onNewTask: () => void;
  onShortcuts: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CommandGroup heading={t('palette.actions')}>
      <CommandItem value={`${t('palette.action')} ${t('palette.newTask')}`} onSelect={onNewTask}>
        {t('palette.newTask')}
      </CommandItem>
      <CommandItem
        value={`${t('palette.action')} ${t('palette.shortcuts')}`}
        onSelect={onShortcuts}
      >
        {t('palette.shortcuts')}
      </CommandItem>
    </CommandGroup>
  );
}

export function LanguageGroup({ onChosen }: { onChosen: () => void }) {
  const { t } = useTranslation();
  const { setChoice } = useLanguage();
  const choices = ['system', ...LANGUAGES.map((entry) => entry.code)] as LanguageChoice[];
  return (
    <CommandGroup heading={t('palette.language')}>
      {choices.map((choice) => {
        const name =
          choice === 'system'
            ? t('language.system')
            : (LANGUAGES.find((entry) => entry.code === choice)?.name ?? choice);
        return (
          <CommandItem
            key={choice}
            value={`${t('palette.language')} ${name} ${choice}`}
            onSelect={() => {
              onChosen();
              setChoice(choice);
            }}
          >
            {name}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
