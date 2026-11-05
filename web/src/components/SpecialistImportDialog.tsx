import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { repositoryLabel } from '../repositories.ts';
import { tagsOfSpecialist } from '../specialistTags.ts';
import type {
  EditorSpecialist,
  FieldError,
  SpecialistTagFolderView,
  SpecialistTagEntry,
} from '../types.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Checkbox } from '../ui/checkbox.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx';
import { Label } from '../ui/label.tsx';
import { Skeleton } from '../ui/skeleton.tsx';

import { RepositoryPicker } from './RepositoryPicker.tsx';
import { SpecialistTagChip } from './SpecialistTagChip.tsx';

const NO_WAITING: ReadonlyMap<string, number> = new Map();

/** Copies project specialists of another repository of the registry into this one. */
export function SpecialistImportDialog({
  api,
  repository,
  specialists,
  open,
  onOpenChange,
  onImported,
}: {
  /** Bound to the repository the specialists are imported into. */
  api: Api;
  repository: string;
  /** The specialists of that repository: a slug with a project file there is taken. */
  specialists: readonly EditorSpecialist[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (slugs: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<SpecialistTagFolderView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  useEffect(() => {
    if (!open) return;
    let closed = false;
    setFolders(null);
    setLoadError(null);
    setMessage(null);
    setErrors([]);
    setChosen([]);
    api.specialistTags().then(
      (view) => {
        if (!closed) setFolders(view.folders);
      },
      (error: Error) => {
        if (!closed) setLoadError(error.message);
      },
    );
    return () => {
      closed = true;
    };
  }, [api, open]);

  const others = useMemo(
    () =>
      (folders ?? []).filter(
        (folder) => folder.repository !== null && folder.repository !== repository,
      ),
    [folders, repository],
  );
  const current = others.find((folder) => folder.repository === source) ?? others[0] ?? null;
  const taken = new Set(
    specialists
      .filter((entry) => entry.level === 'project' || entry.level === 'project_over_global')
      .map((entry) => entry.slug),
  );

  const choose = (path: string) => {
    setSource(path);
    setChosen([]);
    setMessage(null);
    setErrors([]);
  };
  const toggle = (slug: string, on: boolean) =>
    setChosen((now) => (on ? [...now, slug] : now.filter((candidate) => candidate !== slug)));

  const run = async () => {
    if (!current?.repository) return;
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const result = await api.importSpecialists(current.repository, chosen);
      if (result.ok) {
        onOpenChange(false);
        await onImported(result.imported);
      } else if (result.reason === 'conflict') setMessage(result.message);
      else setErrors(result.errors);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entryTags = (entry: SpecialistTagEntry) =>
    tagsOfSpecialist({ shared_tags: [], own_tags: entry.tags });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby="import-about"
      >
        <DialogHeader>
          <DialogTitle>{t('specialists.import.title')}</DialogTitle>
          <DialogDescription id="import-about">{t('specialists.import.about')}</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <Alert variant="destructive">{loadError}</Alert>
        ) : folders === null ? (
          <div role="status" aria-label={t('settings.editor.loading')}>
            <Skeleton className="h-24" />
          </div>
        ) : current === null ? (
          <p className="text-sm text-muted-foreground">{t('specialists.import.noSources')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-source">{t('specialists.import.source')}</Label>
              <RepositoryPicker
                id="import-source"
                label={t('specialists.import.source')}
                repositories={others.map((folder) => folder.repository as string)}
                value={current.repository as string}
                waiting={NO_WAITING}
                onChange={choose}
              />
            </div>
            {current.specialists.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('specialists.import.empty', {
                  name: repositoryLabel(current.repository as string),
                })}
              </p>
            ) : (
              <ul aria-label={t('specialists.import.list')} className="flex flex-col gap-1">
                {current.specialists.map((entry) => {
                  const busySlug = taken.has(entry.slug);
                  const disabled = busySlug || entry.error !== undefined || busy;
                  const id = `import-${entry.slug}`;
                  return (
                    <li key={entry.slug} className="flex items-start gap-2 rounded-md px-1 py-1">
                      <Checkbox
                        id={id}
                        disabled={disabled}
                        checked={chosen.includes(entry.slug)}
                        onCheckedChange={(on) => toggle(entry.slug, on === true)}
                      />
                      <Label
                        htmlFor={id}
                        className="flex min-w-0 flex-1 flex-col gap-1 font-normal"
                      >
                        <span className="truncate font-medium">{entry.name ?? entry.slug}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.slug}
                          {busySlug ? ` · ${t('specialists.import.taken')}` : ''}
                          {entry.error ? ` · ${entry.error}` : ''}
                        </span>
                        {entryTags(entry).length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {entryTags(entry).map((tag) => (
                              <SpecialistTagChip key={tag.name} name={tag.name} />
                            ))}
                          </span>
                        ) : null}
                      </Label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {message ? <Alert variant="destructive">{message}</Alert> : null}
        {errors.length > 0 ? (
          <Alert variant="destructive">
            <ul>
              {errors.map((error) => (
                <li key={`${error.path}:${error.message}`}>
                  <code>{error.path}</code>: {error.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || chosen.length === 0} onClick={() => void run()}>
            {t('specialists.import.run', { total: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
