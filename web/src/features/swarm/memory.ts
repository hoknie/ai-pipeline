import type { SwarmScope, SwarmTab, SwarmTarget } from './types/tabs.ts';

/*
 * What was open in the window during this session of the page: the last tab of the section of the
 * top bar and the last entry of each tab. Only in memory: a reload starts again from the address.
 */
const entries = new Map<string, SwarmTarget>();
let lastTab: SwarmTab | null = null;

const keyOf = (scope: SwarmScope, tab: SwarmTab) => `${scope}:${tab}`;

/** Remembers the place that is open now. */
export function rememberSwarm(scope: SwarmScope, target: SwarmTarget): void {
  // a new entry is not worth coming back to
  entries.set(
    keyOf(scope, target.tab),
    target.entry === 'new' ? { ...target, entry: null } : target,
  );
  if (scope === 'project') lastTab = target.tab;
}

/** The entry that was last open on a tab; the tab itself when there was none. */
export function recalledSwarm(scope: SwarmScope, tab: SwarmTab): SwarmTarget {
  return entries.get(keyOf(scope, tab)) ?? { tab, entry: null };
}

/** The tab the section «Swarm» of the top bar opens: the last one, else «Specialists». */
export function lastSwarmTab(): SwarmTab {
  return lastTab ?? 'specialists';
}

/** Forgets everything (for tests). */
export function forgetSwarm(): void {
  entries.clear();
  lastTab = null;
}
