import { Check, ChevronsUpDown, ExternalLink, Globe } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntryLevel } from '../../../shared/api/types.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../shared/ui/overlays/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/overlays/popover.tsx';
import { SHARED_CHOICE, filterChoices, type ConfigChoice } from './configChoices.ts';

function ChoiceLabel({ choice }: { choice: ConfigChoice }) {
  const { t } = useTranslation();
  if (choice.value === SHARED_CHOICE) {
    return (
      <>
        <Globe aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{t('projectOverview.shared')}</span>
      </>
    );
  }
  return (
    <>
      <ProjectDot color={choice.project.color} />
      <span className="truncate">{choice.project.label}</span>
    </>
  );
}

function ChoiceItem({
  choice,
  chosen,
  onSelect,
}: {
  choice: ConfigChoice;
  chosen: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const level = (value: EntryLevel) =>
    value === 'project_over_global' ? t('projectOverview.overrides') : t('projectOverview.project');
  return (
    <CommandItem
      value={choice.value}
      data-config-choice={choice.value}
      title={choice.value === SHARED_CHOICE ? undefined : choice.project.path}
      onSelect={onSelect}
    >
      <Check className={chosen ? 'opacity-100' : 'opacity-0'} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <ChoiceLabel choice={choice} />
        </span>
        {choice.value === SHARED_CHOICE ? null : (
          <span className="truncate text-xs text-muted-foreground">{level(choice.level)}</span>
        )}
      </span>
    </CommandItem>
  );
}

/** The search and the list: the shared choice pinned on top, the projects under it. */
function ConfigList({
  choices,
  activeValue,
  listId,
  query,
  onQuery,
  onSelect,
}: {
  choices: readonly ConfigChoice[];
  activeValue: string;
  listId: string;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  const visible = filterChoices(choices, query);
  const shared = visible.filter((choice) => choice.value === SHARED_CHOICE);
  const projects = visible.filter((choice) => choice.value !== SHARED_CHOICE);
  const row = (choice: ConfigChoice) => (
    <ChoiceItem
      key={choice.value}
      choice={choice}
      chosen={choice.value === activeValue}
      onSelect={() => onSelect(choice.value)}
    />
  );
  return (
    <Command shouldFilter={false} label={t('projectOverview.choose')}>
      <CommandInput
        value={query}
        onValueChange={onQuery}
        placeholder={t('projectOverview.search')}
      />
      <CommandList id={listId} style={{ maxHeight: '19rem' }}>
        {shared.length > 0 ? (
          <CommandGroup className="sticky top-0 z-10 bg-popover">{shared.map(row)}</CommandGroup>
        ) : null}
        {shared.length > 0 && projects.length > 0 ? (
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
        ) : null}
        {projects.length > 0 ? <CommandGroup>{projects.map(row)}</CommandGroup> : null}
        {projects.length === 0 && query.trim() !== '' ? (
          <p className="py-3 text-center text-sm text-muted-foreground">{t('picker.nothing')}</p>
        ) : null}
      </CommandList>
    </Command>
  );
}

/**
 * The choice between the shared configuration and the projects' own: a dropdown with a search,
 * the shared one pinned on top, and «Open in project» beside it.
 */
export function ConfigPicker({
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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const select = (value: string) => {
    onChoose(value);
    setOpen(false);
    setQuery('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            data-config-picker=""
            aria-label={t('projectOverview.choose')}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listId : undefined}
            className="h-9.5 w-64 max-w-full justify-start px-2.5"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <ChoiceLabel choice={active} />
            </span>
            <ChevronsUpDown aria-hidden className="opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <ConfigList
            choices={choices}
            activeValue={active.value}
            listId={listId}
            query={query}
            onQuery={setQuery}
            onSelect={select}
          />
        </PopoverContent>
      </Popover>
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
