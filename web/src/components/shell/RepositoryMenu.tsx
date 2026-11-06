import { FolderGit2, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import { repositoryLabel, repositoryMatches } from '../../repositories.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { Input } from '../../ui/input.tsx';
import { Label } from '../../ui/label.tsx';

import { navRowClass } from './navRow.ts';

export interface RepositoryChoice {
  /** Repositories to choose from, in display order. */
  repositories: string[];
  /** The path of each repository as shown (home directory as `~`); absent: the path itself. */
  paths?: ReadonlyMap<string, string>;
  /** The selected repository; null until the panel knows its own. */
  selected: string | null;
  /** Runs waiting for an answer, by repository. */
  waiting: ReadonlyMap<string, number>;
  /** The repository `aip web` runs in; it cannot be removed from the list. */
  home: string | null;
  onSelect: (repository: string) => void;
  /** Adds the repository of a path; rejects with the daemon's message when it refuses. */
  onAdd: (path: string) => Promise<void>;
  /** Asks and removes a repository from the list. */
  onRemove: (repository: string) => void;
}

/** The dialog that asks for the path of a repository to add. */
function AddRepositoryDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || path.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(path.trim());
      setPath('');
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>{t('nav.repositoryAddTitle')}</DialogTitle>
            <DialogDescription>{t('nav.repositoryAddDescription')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="repository-path">{t('nav.repositoryPath')}</Label>
          <Input
            id="repository-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/home/me/projects/app"
            autoFocus
            aria-invalid={error !== null}
            aria-describedby={error ? 'repository-path-error' : undefined}
          />
          {error ? (
            <p id="repository-path-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || path.trim() === ''}>
              {t('nav.repositoryAddSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Picks the repository whose queue, configuration and pipelines the panel shows. */
export function RepositoryMenu({
  choice,
  compact = false,
}: {
  choice: RepositoryChoice;
  /** The top bar: the button is as wide as the name, which is cut when long. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { repositories, selected, waiting, home, onSelect, onAdd, onRemove } = choice;
  const shownPath = (path: string) => choice.paths?.get(path) ?? path;
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  // the menu focuses itself on opening; the search takes the focus after it
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => search.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);
  if (selected === null) {
    return (
      <>
        <Button
          variant="outline"
          data-repository-add-empty
          className={cn(navRowClass(), compact && 'w-auto max-w-48')}
          aria-label={t('nav.repositoryAdd')}
          title={t('nav.repositoryAdd')}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden />
          <span className="flex-1 truncate text-left">{t('nav.repositoryAdd')}</span>
        </Button>
        <AddRepositoryDialog open={adding} onOpenChange={setAdding} onAdd={onAdd} />
      </>
    );
  }
  const name = repositoryLabel(selected);
  const label = t('nav.repositoryCurrent', { name });
  const others = repositories
    .filter((path) => path !== selected)
    .reduce((sum, path) => sum + (waiting.get(path) ?? 0), 0);
  const matching = repositories.filter((path) => repositoryMatches(path, shownPath(path), query));
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        data-nav-row
        data-repository-trigger
        className={cn(navRowClass(), 'relative', compact && 'w-auto max-w-48')}
        aria-label={label}
        title={selected}
      >
        <FolderGit2 aria-hidden />
        <span className="flex-1 truncate text-left">{name}</span>
        {others > 0 ? (
          <Badge variant="warn" aria-label={t('nav.repositoryWaiting', { count: others })}>
            {others}
          </Badge>
        ) : null}
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        {trigger}
        <DropdownMenuContent
          align="start"
          aria-label={t('nav.repository')}
          className="w-80 max-w-[calc(100vw-1rem)]"
        >
          <Input
            ref={search}
            type="search"
            value={query}
            placeholder={t('nav.repositorySearch')}
            aria-label={t('nav.repositorySearch')}
            className="mb-1 h-8"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // the menu would take letters for its typeahead; only navigation keys go on
              if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) {
                event.stopPropagation();
              }
            }}
          />
          <div data-repository-list className="max-h-[calc(3.25rem*5.5)] overflow-y-auto">
            <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
              {matching.map((path) => {
                const count = waiting.get(path) ?? 0;
                return (
                  <DropdownMenuRadioItem
                    key={path}
                    value={path}
                    title={path}
                    className="min-h-[3.25rem]"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{repositoryLabel(path)}</span>
                      <span className="text-xs break-all whitespace-normal text-muted-foreground">
                        {shownPath(path)}
                      </span>
                    </span>
                    {count > 0 ? (
                      <Badge
                        variant="warn"
                        className="ml-3"
                        aria-label={t('nav.repositoryWaiting', { count })}
                      >
                        {count}
                      </Badge>
                    ) : null}
                    {path === home ? null : (
                      <button
                        type="button"
                        className="ml-2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label={t('nav.repositoryRemove')}
                        title={t('nav.repositoryRemove')}
                        data-repository-remove={path}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerUp={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setOpen(false);
                          onRemove(path);
                        }}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
            {matching.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                {t('nav.repositoryNone')}
              </p>
            ) : null}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('nav.repositoryAdd')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddRepositoryDialog open={adding} onOpenChange={setAdding} onAdd={onAdd} />
    </>
  );
}
