import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { repositoryLabel } from '../repositories.ts';
import { tagsOfSpecialist } from '../specialistTags.ts';
import type { EditorWorkflow, FieldError } from '../types.ts';
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
import { rawName } from './workflowName.ts';

const NO_WAITING: ReadonlyMap<string, number> = new Map();

/** Copies project pipelines of another repository of the registry into this one. */
export function WorkflowImportDialog({
  api,
  repository,
  workflows,
  open,
  onOpenChange,
  onImported,
}: {
  /** Bound to the repository the pipelines are imported into. */
  api: Api;
  repository: string;
  /** The pipelines of that repository: an id with a project file there is taken. */
  workflows: readonly EditorWorkflow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (ids: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [repositories, setRepositories] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [entries, setEntries] = useState<EditorWorkflow[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  useEffect(() => {
    if (!open) return;
    let closed = false;
    setRepositories(null);
    setLoadError(null);
    setMessage(null);
    setErrors([]);
    setChosen([]);
    setSource(null);
    api.repositories().then(
      (known) => {
        if (!closed) setRepositories(known.map((entry) => entry.path));
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
    () => (repositories ?? []).filter((path) => path !== repository),
    [repositories, repository],
  );
  const current = source !== null && others.includes(source) ? source : (others[0] ?? null);

  // the project pipelines of the chosen source
  useEffect(() => {
    if (!open || current === null) return;
    let closed = false;
    setEntries(null);
    setLoadError(null);
    api
      .forRepository(current)
      .config()
      .then(
        (view) => {
          if (!closed) setEntries(view.workflows.filter((entry) => entry.sources.project));
        },
        (error: Error) => {
          if (!closed) setLoadError(error.message);
        },
      );
    return () => {
      closed = true;
    };
  }, [api, open, current]);

  const taken = new Set(
    workflows
      .filter((entry) => entry.level === 'project' || entry.level === 'project_over_global')
      .map((entry) => entry.id),
  );

  const choose = (path: string) => {
    setSource(path);
    setChosen([]);
    setMessage(null);
    setErrors([]);
  };
  const toggle = (id: string, on: boolean) =>
    setChosen((now) => (on ? [...now, id] : now.filter((candidate) => candidate !== id)));

  const run = async () => {
    if (current === null) return;
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const result = await api.importWorkflows(current, chosen);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby="import-about"
      >
        <DialogHeader>
          <DialogTitle>{t('workflows.import.title')}</DialogTitle>
          <DialogDescription id="import-about">{t('workflows.import.about')}</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <Alert variant="destructive">{loadError}</Alert>
        ) : repositories === null ? (
          <div role="status" aria-label={t('settings.editor.loading')}>
            <Skeleton className="h-24" />
          </div>
        ) : current === null ? (
          <p className="text-sm text-muted-foreground">{t('workflows.import.noSources')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-source">{t('workflows.import.source')}</Label>
              <RepositoryPicker
                id="import-source"
                label={t('workflows.import.source')}
                repositories={others}
                value={current}
                waiting={NO_WAITING}
                onChange={choose}
              />
            </div>
            {entries === null ? (
              <div role="status" aria-label={t('settings.editor.loading')}>
                <Skeleton className="h-16" />
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('workflows.import.empty', { name: repositoryLabel(current) })}
              </p>
            ) : (
              <ul aria-label={t('workflows.import.list')} className="flex flex-col gap-1">
                {entries.map((entry) => {
                  const busyId = taken.has(entry.id);
                  const id = `import-${entry.id}`;
                  const tags = tagsOfSpecialist({ shared_tags: [], own_tags: entry.own_tags });
                  return (
                    <li key={entry.id} className="flex items-start gap-2 rounded-md px-1 py-1">
                      <Checkbox
                        id={id}
                        disabled={busyId || busy}
                        checked={chosen.includes(entry.id)}
                        onCheckedChange={(on) => toggle(entry.id, on === true)}
                      />
                      <Label
                        htmlFor={id}
                        className="flex min-w-0 flex-1 flex-col gap-1 font-normal"
                      >
                        <span className="truncate font-medium">
                          {rawName(entry.sources.project?.raw ?? entry.raw) ?? entry.id}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.id}
                          {busyId ? ` · ${t('workflows.import.taken')}` : ''}
                        </span>
                        {tags.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
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
            {t('workflows.import.run', { total: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
