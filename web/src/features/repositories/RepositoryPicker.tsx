import { Check, FolderGit2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel, repositoryMatches } from '../../shared/lib/catalog/repositories.ts';
import { Badge } from '../../shared/ui/feedback/badge.tsx';
import { ProjectDot } from '../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../shared/ui/overlays/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../shared/ui/overlays/popover.tsx';

/** Repositories whose label, slug or path contains the text, without regard to case. */
export function matchRepositories(repositories: readonly string[], query: string): string[] {
  return repositories.filter((path) => repositoryMatches(path, path, query));
}

function PickerTrigger({
  id,
  label,
  value,
  open,
  listId,
  count,
}: {
  id?: string;
  label: string;
  value: string;
  open: boolean;
  listId: string;
  count: number;
}) {
  const { t } = useTranslation();
  return (
    <PopoverTrigger asChild>
      <Button
        id={id}
        type="button"
        variant="outline"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        title={value}
        className="h-9.5 w-full justify-start px-2.5"
      >
        <FolderGit2 aria-hidden />
        <ProjectDot path={value} />
        <span className="flex-1 truncate text-left">{repositoryLabel(value)}</span>
        {count > 0 ? (
          <Badge variant="warn" aria-label={t('nav.repositoryWaiting', { count })}>
            {count}
          </Badge>
        ) : null}
      </Button>
    </PopoverTrigger>
  );
}

function RepositoryRow({
  path,
  chosen,
  waits,
  onSelect,
}: {
  path: string;
  chosen: boolean;
  waits: number;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CommandItem value={path} title={path} onSelect={onSelect}>
      <Check className={chosen ? 'opacity-100' : 'opacity-0'} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 truncate">
          <ProjectDot path={path} />
          <span className="truncate">{repositoryLabel(path)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{path}</span>
      </span>
      {waits > 0 ? (
        <Badge variant="warn" aria-label={t('nav.repositoryWaiting', { count: waits })}>
          {waits}
        </Badge>
      ) : null}
    </CommandItem>
  );
}

/** A single choice of a repository with a search; looks like the repository menu of the top bar. */
export function RepositoryPicker({
  id,
  label,
  repositories,
  value,
  waiting,
  onChange,
}: {
  id?: string;
  label: string;
  /** Repositories to choose from, in display order. */
  repositories: readonly string[];
  value: string;
  /** Runs waiting for an answer, by repository. */
  waiting: ReadonlyMap<string, number>;
  onChange: (repository: string) => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = matchRepositories(repositories, query);
  const count = waiting.get(value) ?? 0;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PickerTrigger
        id={id}
        label={label}
        value={value}
        open={open}
        listId={listId}
        count={count}
      />
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command shouldFilter={false} label={t('picker.search', { label })}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('queue.form.repositorySearch')}
          />
          <CommandList id={listId}>
            {visible.length === 0 ? <CommandEmpty>{t('picker.nothing')}</CommandEmpty> : null}
            <CommandGroup>
              {visible.map((path) => (
                <RepositoryRow
                  key={path}
                  path={path}
                  chosen={path === value}
                  waits={waiting.get(path) ?? 0}
                  onSelect={() => {
                    onChange(path);
                    setOpen(false);
                    setQuery('');
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
