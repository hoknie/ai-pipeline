import { useHotkey } from '../../shared/lib/browser/hotkeys.ts';
import type { NavProps } from '../shell/nav/NavSidebar.tsx';
import { SECTIONS } from '../sections.ts';

/** Whether the page has selected text. */
function hasSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/** `ctrl+n` opens a new task; `ctrl` and a letter goes to a section. */
export function useAppHotkeys(nav: NavProps): void {
  useHotkey('ctrl+n', (event) => {
    if (!nav.onNewTask) return;
    event.preventDefault();
    nav.onNewTask();
  });
  // the list of sections is fixed, so the hooks run in the same order on every render
  for (const section of SECTIONS) {
    useHotkey(`ctrl+${section.key}`, (event) => {
      // with selected text ctrl+c keeps copying instead of going to the settings
      if (section.key === 'c' && hasSelection()) return;
      event.preventDefault();
      nav.onNavigate(section.view);
    });
  }
}
