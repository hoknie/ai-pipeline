import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from './render.tsx';

/** Opens the «Link kind» select of a row and picks a kind. */
export async function chooseKind(trigger: HTMLElement, name: string): Promise<void> {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
}

/** Opens the «Link kind» select and returns the options shown. */
export async function kindOptions(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findAllByRole('option');
}
