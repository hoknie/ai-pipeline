// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tokenizeShell } from '../src/shared/lib/browser/shellTokens.ts';
import { CodeEditor } from '../src/shared/ui/forms/code/CodeEditor.tsx';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(cleanup);

describe('tokenizeShell', () => {
  it('gives the source back when the tokens are joined', () => {
    const source = 'npm run lint --fix # note\necho "a $HOME" && ls -la | wc';
    expect(
      tokenizeShell(source)
        .map((token) => token.text)
        .join(''),
    ).toBe(source);
  });

  it('marks comments, strings, variables, flags and operators', () => {
    const kinds = Object.fromEntries(
      tokenizeShell('echo "x" $HOME --fix && # c').map((token) => [token.text, token.kind]),
    );
    expect(kinds['"x"']).toBe('string');
    expect(kinds['$HOME']).toBe('variable');
    expect(kinds['--fix']).toBe('flag');
    expect(kinds['&&']).toBe('operator');
    expect(kinds['# c']).toBe('comment');
  });
});

describe('CodeEditor', () => {
  it('numbers the lines and follows the text', () => {
    const { rerender } = render(<CodeEditor value={'a\nb\nc'} onChange={() => {}} />);
    expect(screen.getByTestId('code-editor-gutter').textContent).toBe('1\n2\n3');
    rerender(<CodeEditor value={'a'} onChange={() => {}} />);
    expect(screen.getByTestId('code-editor-gutter').textContent).toBe('1');
  });

  it('highlights the text and reports changes', () => {
    const onChange = vi.fn();
    render(<CodeEditor aria-label="Script" value={'ls # hi'} onChange={onChange} />);
    expect(screen.getByTestId('code-editor-highlight').textContent).toContain('# hi');
    fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'pwd' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
