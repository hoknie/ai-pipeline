import { useCallback, useState } from 'react';

import type { RunView } from '../../shared/api/types.ts';

export type NewTaskPreset = { repository: string; parent: string | null };

/** State of the "new task" dialog: opened once, then kept mounted, with an optional preset. */
export function useNewTask() {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [preset, setPreset] = useState<NewTaskPreset | null>(null);
  const show = useCallback((next: NewTaskPreset | null) => {
    setPreset(next);
    setOpened(true);
    setOpen(true);
  }, []);
  // the repository the page of a new task opens on, after the dialog is expanded
  const [pagePreset, setPagePreset] = useState<NewTaskPreset | null>(null);
  const expand = useCallback((repository: string) => {
    setOpen(false);
    setPagePreset({ repository, parent: null });
  }, []);
  const openNewTask = useCallback(() => show(null), [show]);
  const openSubtask = useCallback(
    (run: RunView) => show({ repository: run.repository, parent: run.id }),
    [show],
  );
  return {
    open,
    setOpen,
    opened,
    preset,
    setPreset,
    openNewTask,
    openSubtask,
    pagePreset,
    setPagePreset,
    expand,
  };
}
