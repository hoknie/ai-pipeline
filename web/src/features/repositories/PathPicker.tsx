import { ArrowUp, Folder, FolderGit2, FolderOpen, House } from 'lucide-react';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { DirectoryListing } from '../../shared/api/systemApi.ts';
import { cn } from '../../shared/lib/browser/cn.ts';
import { Badge } from '../../shared/ui/feedback/badge.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Input } from '../../shared/ui/forms/input.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../shared/ui/overlays/dialog.tsx';

/** Lists the subdirectories of a path; no path is the home directory. */
export type BrowseDirectories = (path?: string) => Promise<DirectoryListing>;

/** A path under the home directory written as `~` or `~/…`; any other path stays as it is. */
export function tildePath(path: string, home: string): string {
  const base = home.endsWith('/') && home.length > 1 ? home.slice(0, -1) : home;
  if (path === base) return '~';
  return path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

/** The folder the browser shows, the typed path and the refusal of the last step. */
function useDirectoryBrowser(open: boolean, start: string, browse: BrowseDirectories) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const show = (next: DirectoryListing) => {
    setListing(next);
    setTyped(tildePath(next.path, next.home));
    setError(null);
  };
  const go = useCallback(
    async (path?: string) => {
      setBusy(true);
      try {
        show(await browse(path === '' ? undefined : path));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [browse],
  );
  useEffect(() => {
    if (!open) return;
    // a start this machine does not have (a path of another computer) opens the home directory
    const first = start.trim();
    void browse(first === '' ? undefined : first).then(show, () => go());
  }, [open, start, browse, go]);
  return { listing, typed, setTyped, error, busy, go };
}

type Browser = ReturnType<typeof useDirectoryBrowser>;

/** «Up», «Home», the path field and «Go». */
function BrowserBar({ browser }: { browser: Browser }) {
  const { t } = useTranslation();
  const { listing, typed, setTyped, busy, go } = browser;
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    // the dialog may stand in another form: Enter opens the typed path and submits nothing
    event.preventDefault();
    event.stopPropagation();
    void go(typed.trim());
  };
  const parent = listing?.parent ?? null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('pathPicker.up')}
        title={t('pathPicker.up')}
        disabled={busy || parent === null}
        onClick={() => parent !== null && void go(parent)}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('pathPicker.home')}
        title={t('pathPicker.home')}
        disabled={busy}
        onClick={() => void go()}
      >
        <House aria-hidden />
      </Button>
      <Input
        aria-label={t('pathPicker.path')}
        value={typed}
        className="min-w-0 flex-1"
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={onKey}
      />
      <Button
        type="button"
        variant="outline"
        disabled={busy || typed.trim() === ''}
        onClick={() => void go(typed.trim())}
      >
        {t('pathPicker.go')}
      </Button>
    </div>
  );
}

/** The subfolders of the shown folder; a click opens one, git roots carry a mark. */
function BrowserList({ browser }: { browser: Browser }) {
  const { t } = useTranslation();
  const { listing, busy, go } = browser;
  const note = (text: string) => (
    <li className="px-2 py-3 text-sm text-muted-foreground">{text}</li>
  );
  return (
    <ul
      aria-label={t('pathPicker.title')}
      aria-busy={busy}
      className="h-72 overflow-y-auto rounded-md border p-1"
    >
      {listing === null
        ? note(t('pathPicker.loading'))
        : listing.entries.length === 0
          ? note(t('pathPicker.empty'))
          : listing.entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  data-directory={entry.path}
                  disabled={busy}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                  )}
                  onClick={() => void go(entry.path)}
                >
                  {entry.git ? (
                    <FolderGit2 aria-hidden className="size-4 shrink-0 text-primary" />
                  ) : (
                    <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  {entry.git ? (
                    <Badge variant="outline" className="ml-auto">
                      git
                    </Badge>
                  ) : null}
                </button>
              </li>
            ))}
      {listing?.truncated ? (
        <li className="px-2 py-1 text-xs text-muted-foreground">
          {t('pathPicker.truncated', { count: listing.entries.length })}
        </li>
      ) : null}
    </ul>
  );
}

/** The folder browser: walks the panel's machine and gives back the chosen folder. */
export function DirectoryDialog({
  open,
  start,
  browse,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  /** The folder to open first; empty: the home directory. */
  start: string;
  browse: BrowseDirectories;
  onOpenChange: (open: boolean) => void;
  onChoose: (path: string) => void;
}) {
  const { t } = useTranslation();
  const browser = useDirectoryBrowser(open, start, browse);
  const { listing, error, busy } = browser;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-directory-dialog>
        <DialogHeader>
          <DialogTitle>{t('pathPicker.title')}</DialogTitle>
          <DialogDescription>{t('pathPicker.description')}</DialogDescription>
        </DialogHeader>
        <BrowserBar browser={browser} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <BrowserList browser={browser} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy || listing === null}
            onClick={() => {
              if (listing === null) return;
              onChoose(tildePath(listing.path, listing.home));
              onOpenChange(false);
            }}
          >
            {listing?.git ? <FolderGit2 aria-hidden /> : <FolderOpen aria-hidden />}
            {t('pathPicker.choose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A path field with «Browse…», which opens the folder browser at the typed path. */
export function PathInput({
  id,
  value,
  onChange,
  browse,
  placeholder,
  invalid = false,
  describedBy,
  autoFocus = false,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (path: string) => void;
  browse: BrowseDirectories;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string | undefined;
  autoFocus?: boolean;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        id={id}
        value={value}
        required={required}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="min-w-0 flex-1"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button type="button" variant="outline" onClick={() => setBrowsing(true)} data-path-browse>
        <FolderOpen aria-hidden />
        {t('pathPicker.browse')}
      </Button>
      <DirectoryDialog
        open={browsing}
        start={value}
        browse={browse}
        onOpenChange={setBrowsing}
        onChoose={onChange}
      />
    </div>
  );
}
