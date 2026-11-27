import { cleanup, render as baseRender, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { ConfirmProvider } from '../src/shared/ui/overlays/confirm.tsx';
import { Toaster } from '../src/shared/ui/feedback/toaster.tsx';
import { TooltipProvider } from '../src/shared/ui/feedback/tooltip.tsx';

// jsdom has no layout; ProseMirror still asks a selection range for its geometry.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [new DOMRect()] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

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

/** Open the source of this particular editor, including when several groups are present. */
export function markdownSource(field: HTMLElement): HTMLTextAreaElement {
  if (!field.isConnected) {
    field = screen.getByLabelText(field.getAttribute('aria-label')!);
  }
  if (field instanceof HTMLTextAreaElement) return field;
  let container: HTMLElement | null = field;
  while (container && !within(container).queryByRole('toolbar', { name: 'Text formatting' })) {
    container = container.parentElement;
  }
  if (!container) throw new Error('Markdown toolbar not found');
  const toggle = within(container).getByRole('button', { name: 'Markdown source' });
  if (toggle.getAttribute('aria-pressed') !== 'true') fireEvent.click(toggle);
  return within(container).getByLabelText<HTMLTextAreaElement>(field.getAttribute('aria-label')!);
}

export function setMarkdown(field: HTMLElement, value: string): void {
  fireEvent.change(markdownSource(field), { target: { value } });
}

export function markdownValue(field: HTMLElement): string {
  return markdownSource(field).value;
}
