import { useHotkey } from '../../shared/lib/browser/hotkeys.ts';
import type { NavProps } from '../shell/nav/NavSidebar.tsx';
import { SECTIONS } from '../sections.ts';

/** `n` opens a new task; `g` and a letter goes to a section. */
export function useAppHotkeys(nav: NavProps): void {
  useHotkey('n', (event) => {
    if (!nav.onNewTask) return;
    event.preventDefault();
    nav.onNewTask();
  });
  // the list of sections is fixed, so the hooks run in the same order on every render
  for (const section of SECTIONS) {
    useHotkey(`g ${section.key}`, (event) => {
      event.preventDefault();
      nav.onNavigate(section.view);
    });
  }
}
