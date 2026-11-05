import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { requestFocus } from '../../hotkeys.ts';
import { runTitle, taskNumber } from '../../format.ts';
import { LANGUAGES, useLanguage, type LanguageChoice } from '../../i18n/index.ts';
import { SECTIONS } from '../../sections.ts';
import type { Route } from '../../route.ts';
import { runStatusLabel } from '../../status.ts';
import type { EditorSpecialist, EditorWorkflow, RunView } from '../../types.ts';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../ui/command.tsx';
import { orderGroups } from '../order.ts';
import { WorkflowBadge } from '../WorkflowBadge.tsx';
import { rawName } from '../workflowName.ts';

interface Entries {
  workflows: EditorWorkflow[];
  specialists: EditorSpecialist[];
}

/**
 * Palette of commands: sections, runs (waiting ones first), groups, workflows, specialists,
 * actions and languages. Sections and actions are searched by their labels in the active language.
 */
export function CommandPalette({
  open,
  onOpenChange,
  api,
  runs,
  route,
  onRoute,
  onShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: Api;
  runs: RunView[];
  route: Route;
  onRoute: (route: Route) => void;
  onShortcuts: () => void;
}) {
  const { t } = useTranslation();
  const { setChoice } = useLanguage();
  const [entries, setEntries] = useState<Entries | null>(null);
  useEffect(() => {
    if (!open || entries) return;
    api.config().then(
      (config) => setEntries({ workflows: config.workflows, specialists: config.specialists }),
      () => setEntries({ workflows: [], specialists: [] }),
    );
  }, [open, entries, api]);

  const go = (next: Route) => {
    onOpenChange(false);
    onRoute(next);
  };
  const to = (view: Route['view'], run: string | null = null): Route => ({
    view,
    run,
    group: null,
    step: null,
    tab: null,
  });
  const openRun = runs.find((candidate) => candidate.id === route.run) ?? null;
  const sorted = [...runs].sort(
    (left, right) => Number(right.state === 'needs_human') - Number(left.state === 'needs_human'),
  );
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('palette.title')}>
      <CommandInput placeholder={t('palette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('palette.empty')}</CommandEmpty>
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
        <CommandGroup heading={t('palette.runs')}>
          {sorted.map((run) => (
            <CommandItem
              key={run.id}
              value={`${t('palette.run')} ${taskNumber(run.number)} ${runTitle(run)} ${run.id} ${run.workflowName} ${run.workflow}`}
              onSelect={() => go({ view: 'runs', run: run.id, group: null, step: null, tab: null })}
            >
              <span className="truncate">
                <span className="font-mono text-xs text-muted-foreground">
                  {taskNumber(run.number)}
                </span>{' '}
                {runTitle(run)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <WorkflowBadge id={run.workflow} name={run.workflowName} focusable={false} />
                <span className="text-xs text-muted-foreground">{runStatusLabel(run, t)}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        {openRun && openRun.groups.length > 1 ? (
          <CommandGroup heading={t('palette.groups')}>
            {orderGroups(openRun.groups).map((group) => (
              <CommandItem
                key={group.slug}
                value={`${t('palette.group')} ${group.title} ${group.slug}`}
                onSelect={() =>
                  go({ view: 'runs', run: openRun.id, group: group.slug, step: null, tab: null })
                }
              >
                {group.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {entries && entries.workflows.length > 0 ? (
          <CommandGroup heading={t('palette.workflows')}>
            {entries.workflows.map((workflow) => {
              const name = rawName(workflow.raw) ?? workflow.id;
              return (
                <CommandItem
                  key={workflow.id}
                  value={`${t('palette.workflows')} ${name} ${workflow.id}`}
                  title={workflow.id}
                  onSelect={() => go(to('workflows', workflow.id))}
                >
                  {name}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {entries && entries.specialists.length > 0 ? (
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
        <CommandGroup heading={t('palette.actions')}>
          <CommandItem
            value={`${t('palette.action')} ${t('palette.newTask')}`}
            onSelect={() => {
              go(to('queue'));
              requestFocus('queue-task');
            }}
          >
            {t('palette.newTask')}
          </CommandItem>
          <CommandItem
            value={`${t('palette.action')} ${t('palette.shortcuts')}`}
            onSelect={() => {
              onOpenChange(false);
              onShortcuts();
            }}
          >
            {t('palette.shortcuts')}
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={t('palette.language')}>
          {(['system', ...LANGUAGES.map((entry) => entry.code)] as LanguageChoice[]).map(
            (choice) => {
              const name =
                choice === 'system'
                  ? t('language.system')
                  : (LANGUAGES.find((entry) => entry.code === choice)?.name ?? choice);
              return (
                <CommandItem
                  key={choice}
                  value={`${t('palette.language')} ${name} ${choice}`}
                  onSelect={() => {
                    onOpenChange(false);
                    setChoice(choice);
                  }}
                >
                  {name}
                </CommandItem>
              );
            },
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
