import { Check, FolderGit2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../repositories.ts';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';

/** Repositories whose directory name or path contains the text, without regard to case. */
export function matchRepositories(repositories: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...repositories];
  return repositories.filter(
    (path) =>
      repositoryLabel(path).toLowerCase().includes(needle) || path.toLowerCase().includes(needle),
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
          <span className="flex-1 truncate text-left">{repositoryLabel(value)}</span>
          {count > 0 ? (
            <Badge variant="warn" aria-label={t('nav.repositoryWaiting', { count })}>
              {count}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
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
              {visible.map((path) => {
                const waits = waiting.get(path) ?? 0;
                return (
                  <CommandItem
                    key={path}
                    value={path}
                    title={path}
                    onSelect={() => {
                      onChange(path);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <Check className={path === value ? 'opacity-100' : 'opacity-0'} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{repositoryLabel(path)}</span>
                      <span className="truncate text-xs text-muted-foreground">{path}</span>
                    </span>
                    {waits > 0 ? (
                      <Badge
                        variant="warn"
                        aria-label={t('nav.repositoryWaiting', { count: waits })}
                      >
                        {waits}
                      </Badge>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
