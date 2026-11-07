import { useEffect, useMemo, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type {
  EditorSpecialist,
  FieldError,
  SpecialistTagFolderView,
} from '../../../shared/api/types.ts';

/** The folders of the other repositories that hold specialists, loaded when the dialog opens. */
function useFolders(api: Api, open: boolean, reset: () => void) {
  const [folders, setFolders] = useState<SpecialistTagFolderView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let closed = false;
    setFolders(null);
    setLoadError(null);
    reset();
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
    // `reset` only sets state to empty values
  }, [api, open]);
  return { folders, loadError };
}

/** What the person chose in the dialog and what the last import said. */
function useSelection() {
  const [source, setSource] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const clearAnswer = () => {
    setMessage(null);
    setErrors([]);
  };
  const reset = () => {
    clearAnswer();
    setChosen([]);
  };
  const choose = (path: string) => {
    setSource(path);
    reset();
  };
  const toggle = (slug: string, on: boolean) =>
    setChosen((now) => (on ? [...now, slug] : now.filter((candidate) => candidate !== slug)));
  return {
    source,
    chosen,
    busy,
    setBusy,
    message,
    setMessage,
    errors,
    setErrors,
    clearAnswer,
    reset,
    choose,
    toggle,
  };
}

/** Copies project specialists of another repository of the registry into this one. */
export function useSpecialistImport({
  api,
  repository,
  specialists,
  open,
  onOpenChange,
  onImported,
}: {
  api: Api;
  repository: string;
  specialists: readonly EditorSpecialist[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (slugs: string[]) => Promise<void>;
}) {
  const selection = useSelection();
  const { folders, loadError } = useFolders(api, open, selection.reset);
  const others = useMemo(
    () =>
      (folders ?? []).filter(
        (folder) => folder.repository !== null && folder.repository !== repository,
      ),
    [folders, repository],
  );
  const current =
    others.find((folder) => folder.repository === selection.source) ?? others[0] ?? null;
  const taken = new Set(
    specialists
      .filter((entry) => entry.level === 'project' || entry.level === 'project_over_global')
      .map((entry) => entry.slug),
  );
  const run = async () => {
    if (!current?.repository) return;
    selection.setBusy(true);
    selection.clearAnswer();
    try {
      const result = await api.importSpecialists(current.repository, selection.chosen);
      if (result.ok) {
        onOpenChange(false);
        await onImported(result.imported);
      } else if (result.reason === 'conflict') selection.setMessage(result.message);
      else selection.setErrors(result.errors);
    } catch (error) {
      selection.setMessage((error as Error).message);
    } finally {
      selection.setBusy(false);
    }
  };
  return { ...selection, folders, loadError, others, current, taken, run };
}
