import { useCallback, useState } from 'react';

import type { RunView } from '../../shared/api/types.ts';

/** State of the "new task" dialog: opened once, then kept mounted, with an optional preset. */
export function useNewTask() {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [preset, setPreset] = useState<{ repository: string; parent: string } | null>(null);
  const show = useCallback((next: { repository: string; parent: string } | null) => {
    setPreset(next);
    setOpened(true);
    setOpen(true);
  }, []);
  const openNewTask = useCallback(() => show(null), [show]);
  const openSubtask = useCallback(
    (run: RunView) => show({ repository: run.repository, parent: run.id }),
    [show],
  );
  return { open, setOpen, opened, preset, setPreset, openNewTask, openSubtask };
}
