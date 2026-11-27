// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from './render.tsx';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(cleanup);

it.each(['', ' \t\n  '])('exposes the empty placeholder without changing %j', (value) => {
  const onChange = vi.fn();
  render(
    <MarkdownField
      aria-label="Body"
      value={value}
      onChange={onChange}
      placeholder="Describe the task"
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Body' });
  expect(editor.getAttribute('aria-placeholder')).toBe('Describe the task');
  expect(screen.getByText('Describe the task').getAttribute('aria-hidden')).toBe('true');
  expect(onChange).not.toHaveBeenCalled();
});
