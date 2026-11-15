import type { ParseKeys } from 'i18next';

import { SECTIONS } from './sections.ts';

export type ShortcutGroup = 'general' | 'navigation' | 'runs' | 'queue';

export interface Shortcut {
  combo: string;
  /** Key of the label in the locales: `shortcuts.*` or `nav.*`. */
  label: ParseKeys;
  group: ShortcutGroup;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['general', 'navigation', 'runs', 'queue'];

/** Every shortcut of the panel: the reference dialog reads this list. */
export const SHORTCUTS: Shortcut[] = [
  { combo: 'mod+k', label: 'shortcuts.palette', group: 'general' },
  { combo: '?', label: 'shortcuts.help', group: 'general' },
  { combo: 'Escape', label: 'shortcuts.close', group: 'general' },
  { combo: 'ctrl+n', label: 'shortcuts.newTask', group: 'general' },
  { combo: 'ctrl+p', label: 'shortcuts.project', group: 'general' },
  ...SECTIONS.map((section) => ({
    combo: `ctrl+${section.key}`,
    label: `nav.${section.labelKey}` as const,
    group: 'navigation' as const,
  })),
  { combo: 'j', label: 'shortcuts.nextRun', group: 'runs' },
  { combo: 'k', label: 'shortcuts.previousRun', group: 'runs' },
  { combo: 'Alt+ArrowUp', label: 'shortcuts.moveItem', group: 'queue' },
  { combo: 'Alt+ArrowDown', label: 'shortcuts.moveItem', group: 'queue' },
];
