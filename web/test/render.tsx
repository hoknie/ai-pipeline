import { cleanup, render as baseRender, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { ConfirmProvider } from '../src/shared/ui/overlays/confirm.tsx';
import { Toaster } from '../src/shared/ui/feedback/toaster.tsx';
import { TooltipProvider } from '../src/shared/ui/feedback/tooltip.tsx';

function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <ConfirmProvider>
        {children}
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

/** Renders a component with the providers the shell gives to pages. */
export function render(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}) {
  return baseRender(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react';
export { cleanup };

import { fireEvent, screen, within } from '@testing-library/react';

/** Opens a Radix select by its trigger (role `combobox`) and picks an option by its name. */
export function choose(trigger: HTMLElement, option: string | RegExp): void {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: option }));
}

/** Opens a tab: Radix activates a tab on the mouse going down. */
export function openTab(name: string | RegExp): void {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}

/** Switches the first Markdown field of the scope to `MD` and turns its preview on or off. */
export function previewMarkdown(scope: HTMLElement | null = null, on = true): void {
  const area = scope === null ? screen : within(scope);
  const md = area.getAllByRole('radio', { name: 'MD' })[0]!;
  if (md.getAttribute('aria-checked') !== 'true') fireEvent.click(md);
  const button = area.getAllByRole('button', { name: 'Preview' })[0]!;
  if ((button.getAttribute('aria-pressed') === 'true') !== on) fireEvent.click(button);
}
