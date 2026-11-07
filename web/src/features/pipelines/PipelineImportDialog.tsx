import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import type { EditorPipeline, FieldError } from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../shared/ui/overlays/dialog.tsx';
import { Label } from '../../shared/ui/forms/label.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';

import { ImportErrors, ImportSource } from './ImportParts.tsx';
import { RepositoryPicker } from '../repositories/index.ts';

const NO_WAITING: ReadonlyMap<string, number> = new Map();

/** The repositories to import from and the project pipelines of the chosen one. */
function useImportSources(api: Api, open: boolean, repository: string, onReset: () => void) {
  const [repositories, setRepositories] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [entries, setEntries] = useState<EditorPipeline[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let closed = false;
    setRepositories(null);
    setLoadError(null);
    onReset();
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
          if (!closed) setEntries(view.pipelines.filter((entry) => entry.sources.project));
        },
        (error: Error) => {
          if (!closed) setLoadError(error.message);
        },
      );
    return () => {
      closed = true;
    };
  }, [api, open, current]);
  return { repositories, loadError, entries, others, current, setSource };
}

/** The pipelines chosen to import, and the import itself with its outcome. */
function useImportRun(
  api: Api,
  onOpenChange: (open: boolean) => void,
  onImported: (ids: string[]) => Promise<void>,
) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const reset = useCallback(() => {
    setMessage(null);
    setErrors([]);
    setChosen([]);
  }, []);
  const toggle = (id: string, on: boolean) =>
    setChosen((now) => (on ? [...now, id] : now.filter((candidate) => candidate !== id)));
  const run = async (source: string | null) => {
    if (source === null) return;
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const result = await api.importPipelines(source, chosen);
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
  return { chosen, busy, message, errors, reset, toggle, run };
}

/** Ids the repository already has as a project file. */
const takenIds = (pipelines: readonly EditorPipeline[]): Set<string> =>
  new Set(
    pipelines
      .filter((entry) => entry.level === 'project' || entry.level === 'project_over_global')
      .map((entry) => entry.id),
  );

/** Copies project pipelines of another repository of the registry into this one. */
export function PipelineImportDialog({
  api,
  repository,
  pipelines,
  open,
  onOpenChange,
  onImported,
}: {
  /** Bound to the repository the pipelines are imported into. */
  api: Api;
  repository: string;
  /** The pipelines of that repository: an id with a project file there is taken. */
  pipelines: readonly EditorPipeline[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (ids: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const importing = useImportRun(api, onOpenChange, onImported);
  const { chosen, busy, message, errors, toggle } = importing;
  const { repositories, loadError, entries, others, current, setSource } = useImportSources(
    api,
    open,
    repository,
    importing.reset,
  );
  const taken = takenIds(pipelines);
  const choose = (path: string) => {
    setSource(path);
    importing.reset();
  };
  const run = () => importing.run(current);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby="import-about"
      >
        <DialogHeader>
          <DialogTitle>{t('pipelines.import.title')}</DialogTitle>
          <DialogDescription id="import-about">{t('pipelines.import.about')}</DialogDescription>
        </DialogHeader>
        <ImportSource
          loadError={loadError}
          repositories={repositories}
          others={others}
          current={current}
          entries={entries}
          taken={taken}
          chosen={chosen}
          busy={busy}
          onChoose={choose}
          onToggle={toggle}
        />
        {message ? <Alert variant="destructive">{message}</Alert> : null}
        <ImportErrors errors={errors} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || chosen.length === 0} onClick={() => void run()}>
            {t('pipelines.import.run', { total: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
