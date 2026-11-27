// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkupToolbar } from '../src/shared/ui/forms/MarkupToolbar.tsx';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

describe('visual Markdown toolbar', () => {
  it('keeps source accessible when formatting is unavailable', () => {
    const toggle = vi.fn();
    render(<MarkupToolbar editing={false} source={false} onSource={toggle} onMark={vi.fn()} />);
    const bold = screen.getByRole<HTMLButtonElement>('button', { name: 'Bold' });
    const source = screen.getByRole<HTMLButtonElement>('button', { name: 'Markdown source' });
    expect(bold.disabled).toBe(true);
    expect(source.disabled).toBe(false);
    expect(source.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(source);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('disables formatting in source mode and exposes its pressed state', () => {
    render(<MarkupToolbar editing source onSource={vi.fn()} onMark={vi.fn()} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Bold' }).disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Markdown source' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('moves between formatting controls with arrow keys', async () => {
    render(<MarkupToolbar editing source={false} onSource={vi.fn()} onMark={vi.fn()} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    bold.focus();
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Italic' })),
    );
  });
});
