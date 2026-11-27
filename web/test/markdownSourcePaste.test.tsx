// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from './render.tsx';
import { MarkdownField } from '../src/shared/ui/forms/MarkdownField.tsx';

afterEach(cleanup);

it('pastes semantic HTML safely into the source, preserving code language and table', () => {
  function Field() {
    const [value, setValue] = useState('');
    return <MarkdownField aria-label="Description" value={value} onChange={setValue} />;
  }
  render(<Field />);
  fireEvent.click(screen.getByRole('button', { name: 'Markdown source' }));
  const source = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' });
  const html =
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' +
    '<pre><code class="language-json">{"x": 1}</code></pre><img src="https://invalid.test/a" alt="picture">';
  fireEvent.paste(source, {
    clipboardData: { getData: (type: string) => (type === 'text/html' ? html : '') },
  });
  expect(source.value).toContain('| A | B |');
  expect(source.value).toContain('```json\n{"x": 1}\n```');
  expect(source.value).toContain('picture');
  expect(source.value).not.toContain('https://invalid.test');
});
