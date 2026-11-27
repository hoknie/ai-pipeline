// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from './render.tsx';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(cleanup);

it('accepts external updates without reporting edits and keeps them through source mode', () => {
  const changed = vi.fn();
  const field = (value: string) => (
    <MarkdownField aria-label="Description" value={value} onChange={changed} />
  );
  const { rerender } = render(field('Initial'));
  rerender(field('Updated **outside**'));
  expect(screen.getByText('outside').tagName).toBe('STRONG');
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' }).value).toBe(
    'Updated **outside**',
  );
  rerender(field('Another _external_ update'));
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' }).value).toBe(
    'Another _external_ update',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
  expect(screen.getByText('external').tagName).toBe('EM');
  expect(changed).not.toHaveBeenCalled();
});
