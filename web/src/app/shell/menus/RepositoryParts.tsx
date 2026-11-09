import { FolderGit2, Plus, X } from 'lucide-react';
import { useState, type FormEvent, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { PathInput, type BrowseDirectories } from '../../../features/repositories/index.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../shared/ui/overlays/dropdown-menu.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';

import { navRowClass } from '../nav/navRow.ts';

/** The dialog that asks for the path of a repository to add. */
export function AddRepositoryDialog({
  open,
  onOpenChange,
  onAdd,
  browse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string) => Promise<void>;
  browse: BrowseDirectories;
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
          <PathInput
            id="repository-path"
            value={path}
            onChange={setPath}
            browse={browse}
            placeholder="~/projects/app"
            autoFocus
            invalid={error !== null}
            describedBy={error ? 'repository-path-error' : undefined}
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

/** The button of the closed menu: the repository name and the runs waiting in the others. */
export function RepositoryTrigger({
  name,
  label,
  title,
  others,
  compact,
}: {
  name: string;
  label: string;
  title: string;
  others: number;
  compact: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        data-nav-row
        data-repository-trigger
        className={cn(navRowClass(), 'relative', compact && 'w-auto max-w-48')}
        aria-label={label}
        title={title}
      >
        <FolderGit2 aria-hidden />
        <ProjectDot path={title} />
        <span className="flex-1 truncate text-left">{name}</span>
        {others > 0 ? (
          <Badge variant="warn" aria-label={t('nav.repositoryWaiting', { count: others })}>
            {others}
          </Badge>
        ) : null}
      </Button>
    </DropdownMenuTrigger>
  );
}

/** A repository in the list: its name and path, the waiting runs and the remove button. */
export function RepositoryItem({
  path,
  shown,
  count,
  removable,
  onRemove,
}: {
  path: string;
  shown: string;
  count: number;
  removable: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenuRadioItem value={path} title={path} className="min-h-[3.25rem]">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 truncate">
          <ProjectDot path={path} />
          <span className="truncate">{repositoryLabel(path)}</span>
        </span>
        <span className="text-xs break-all whitespace-normal text-muted-foreground">{shown}</span>
      </span>
      {count > 0 ? (
        <Badge variant="warn" className="ml-3" aria-label={t('nav.repositoryWaiting', { count })}>
          {count}
        </Badge>
      ) : null}
      {!removable ? null : (
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
            onRemove();
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </DropdownMenuRadioItem>
  );
}

/** The search field on top of the list; the menu would take letters for its typeahead. */
export function RepositorySearch({
  ref,
  query,
  onQuery,
}: {
  ref: Ref<HTMLInputElement>;
  query: string;
  onQuery: (query: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Input
      ref={ref}
      type="search"
      value={query}
      placeholder={t('nav.repositorySearch')}
      aria-label={t('nav.repositorySearch')}
      className="mb-1 h-8"
      onChange={(event) => onQuery(event.target.value)}
      onKeyDown={(event) => {
        // the menu would take letters for its typeahead; only navigation keys go on
        if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) {
          event.stopPropagation();
        }
      }}
    />
  );
}

/** The matching repositories as radio items, or a note when none matches. */
export function RepositoryList(props: {
  matching: string[];
  selected: string;
  shownPath: (path: string) => string;
  waiting: ReadonlyMap<string, number>;
  home: string | null;
  onSelect: (repository: string) => void;
  onRemove: (repository: string) => void;
}) {
  const { t } = useTranslation();
  const { matching, waiting } = props;
  return (
    <div data-repository-list className="max-h-[calc(3.25rem*5.5)] overflow-y-auto">
      <DropdownMenuRadioGroup value={props.selected} onValueChange={props.onSelect}>
        {matching.map((path) => (
          <RepositoryItem
            key={path}
            path={path}
            shown={props.shownPath(path)}
            count={waiting.get(path) ?? 0}
            removable={path !== props.home}
            onRemove={() => props.onRemove(path)}
          />
        ))}
      </DropdownMenuRadioGroup>
      {matching.length === 0 ? (
        <p className="px-2 py-3 text-center text-sm text-muted-foreground">
          {t('nav.repositoryNone')}
        </p>
      ) : null}
    </div>
  );
}

/** The only control while no repository is known: a button that opens the dialog to add one. */
export function AddFirstRepository({
  compact,
  onAdd,
  browse,
}: {
  compact: boolean;
  onAdd: (path: string) => Promise<void>;
  browse: BrowseDirectories;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
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
      <AddRepositoryDialog open={adding} onOpenChange={setAdding} onAdd={onAdd} browse={browse} />
    </>
  );
}
