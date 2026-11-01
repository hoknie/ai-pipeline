import { FolderGit2, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import { repositoryLabel } from '../../repositories.ts';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.tsx';

import { navRowClass } from './navRow.ts';

export interface RepositoryChoice {
  /** Repositories to choose from, in display order. */
  repositories: string[];
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

/** Picks the repository whose queue, configuration and workflows the panel shows. */
export function RepositoryMenu({
  choice,
  collapsed = false,
}: {
  choice: RepositoryChoice;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const { repositories, selected, waiting, home, onSelect, onAdd, onRemove } = choice;
  const [adding, setAdding] = useState(false);
  if (selected === null) {
    return (
      <>
        <Button
          variant="outline"
          data-repository-add-empty
          className={navRowClass(collapsed)}
          aria-label={t('nav.repositoryAdd')}
          title={t('nav.repositoryAdd')}
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden />
          {collapsed ? null : (
            <span className="flex-1 truncate text-left">{t('nav.repositoryAdd')}</span>
          )}
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
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        data-nav-row
        data-repository-trigger
        className={cn(navRowClass(collapsed), 'relative')}
        aria-label={label}
        title={selected}
      >
        <FolderGit2 aria-hidden />
        {collapsed ? null : <span className="flex-1 truncate text-left">{name}</span>}
        {others > 0 ? (
          <Badge
            variant="warn"
            aria-label={t('nav.repositoryWaiting', { count: others })}
            className={
              collapsed
                ? 'absolute -right-2 -top-2 min-w-4 justify-center px-1 py-0 text-[10px] leading-4'
                : undefined
            }
          >
            {others}
          </Badge>
        ) : null}
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{selected}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent align="start" aria-label={t('nav.repository')}>
          <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
            {repositories.map((path) => {
              const count = waiting.get(path) ?? 0;
              return (
                <DropdownMenuRadioItem key={path} value={path} title={path}>
                  <span className="flex-1 truncate">{repositoryLabel(path)}</span>
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
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
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
