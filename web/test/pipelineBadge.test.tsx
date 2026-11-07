// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { TagLabel } from '../src/shared/ui/feedback/TagChip.tsx';
import { PipelineBadge } from '../src/shared/ui/feedback/PipelineBadge.tsx';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(() => cleanup());

describe('pipeline badge', () => {
  it('shows the name, with the id in the tooltip', async () => {
    render(<PipelineBadge id="feature" name="Новая функция" />);
    const badge = screen.getByLabelText('Pipeline: Новая функция (feature)');
    expect(badge.textContent).toBe('Новая функция');
    fireEvent.focus(badge);
    expect((await screen.findByRole('tooltip')).textContent).toContain('(feature)');
  });

  it('has the accessible name and a tooltip on focus', async () => {
    render(<PipelineBadge id="feature" name="feature" />);
    const badge = screen.getByLabelText('Pipeline: feature');
    expect(badge.textContent).toBe('feature');
    fireEvent.focus(badge);
    expect((await screen.findByRole('tooltip')).textContent).toContain('Pipeline: feature');
  });

  it('differs from a tag: rectangular, not monospace, with an icon', () => {
    render(
      <>
        <PipelineBadge id="feature" name="feature" />
        <TagLabel
          tag={{ id: 'auth', repository: '/repo', name: 'auth', color: 'blue', task: null }}
        />
      </>,
    );
    const badge = screen.getByLabelText('Pipeline: feature');
    expect(badge.className).toContain('rounded-md');
    expect(badge.className).not.toContain('rounded-full');
    expect(badge.className).not.toContain('font-mono');
    expect(badge.querySelector('svg')).toBeTruthy();
    expect(document.querySelector('[data-tag="auth"]')!.className).toContain('rounded-full');
  });

  it('is focusable by default and not when focusable is false', () => {
    const { rerender } = render(<PipelineBadge id="feature" name="feature" />);
    expect(screen.getByLabelText('Pipeline: feature').getAttribute('tabindex')).toBe('0');
    rerender(<PipelineBadge id="feature" name="feature" focusable={false} />);
    expect(screen.getByLabelText('Pipeline: feature').hasAttribute('tabindex')).toBe(false);
  });
});
