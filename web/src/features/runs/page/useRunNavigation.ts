import { useEffect, useRef, useState } from 'react';

import { useHotkey } from '../../../shared/lib/browser/hotkeys.ts';
import type { Route } from '../../../shared/lib/nav/route.ts';
import type { RunView } from '../../../shared/api/types.ts';

/** The screen of a narrow window, the choice of a run and the keys `j` and `k` that step through the list. */
export function useRunNavigation(args: {
  route: Route;
  onRoute: (route: Route) => void;
  wide: boolean;
  shown: RunView[];
  run: RunView | null;
}) {
  const { route, onRoute, wide, shown, run } = args;
  const [screen, setScreen] = useState<'list' | 'detail'>(route.group ? 'detail' : 'list');
  const select = (runId: string, slug: string | null) => {
    setScreen('detail');
    onRoute({ view: 'runs', run: runId, group: slug, step: null, tab: null });
  };
  const step = (delta: number) => {
    if (shown.length === 0) return;
    const at = shown.findIndex((candidate) => candidate.id === run?.id);
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + delta))];
    if (!next) return;
    select(next.id, null);
    document
      .querySelector(`[data-run="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  useHotkey('j', () => step(1));
  useHotkey('k', () => step(-1));

  // A jump to another run or group from outside the list (address, palette, topology) opens the
  // run screen; the first automatic choice of a run (null → run) keeps the list.
  const seen = useRef({ run: route.run, group: route.group, step: route.step });
  useEffect(() => {
    const before = seen.current;
    seen.current = { run: route.run, group: route.group, step: route.step };
    const moved =
      (before.run !== null && route.run !== before.run) ||
      (route.group !== null && (route.group !== before.group || route.step !== before.step));
    if (moved && route.run) setScreen('detail');
  }, [route.run, route.group, route.step]);

  useEffect(() => {
    if (wide) setScreen('list');
  }, [wide]);

  return { screen, setScreen, select };
}
