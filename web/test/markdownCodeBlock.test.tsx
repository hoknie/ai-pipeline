// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from './render.tsx';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(cleanup);

describe('code blocks in the task editor', () => {
  it('highlights JSON, preserves source and safely falls back for unknown languages', () => {
    const source =
      '```json\n{\n  "key": 12\n}\n```\n\n```unknown-language\n<img onerror=alert(1)>\n```';
    const { container } = render(
      <MarkdownField aria-label="Description" value={source} onChange={vi.fn()} />,
    );
    const blocks = container.querySelectorAll('pre code');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.textContent).toBe('{\n  "key": 12\n}');
    expect(blocks[0]?.querySelector('.hljs-number')?.textContent).toBe('12');
    expect(blocks[1]?.textContent).toBe('<img onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' }).value).toBe(
      source,
    );
  });
});
