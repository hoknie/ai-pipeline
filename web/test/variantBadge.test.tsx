// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { VariantBadge } from '../src/shared/ui/feedback/VariantBadge.tsx';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(() => cleanup());

describe('variant badge', () => {
  it('shows the name, with the id in the tooltip', async () => {
    render(<VariantBadge id="light" name="Лёгкий" />);
    const badge = screen.getByLabelText('Variant: Лёгкий (light)');
    expect(badge.textContent).toBe('Лёгкий');
    fireEvent.focus(badge);
    expect((await screen.findByRole('tooltip')).textContent).toContain('(light)');
  });

  it('names the id alone when the variant has no name', () => {
    render(<VariantBadge id="light" name="light" />);
    expect(screen.getByLabelText('Variant: light').textContent).toBe('light');
  });

  it('shows nothing for the default variant', () => {
    const { container } = render(<VariantBadge id="default" name="default" />);
    expect(container.textContent).toBe('');
  });

  it('is focusable by default and not when focusable is false', () => {
    const { rerender } = render(<VariantBadge id="light" name="light" />);
    expect(screen.getByLabelText('Variant: light').getAttribute('tabindex')).toBe('0');
    rerender(<VariantBadge id="light" name="light" focusable={false} />);
    expect(screen.getByLabelText('Variant: light').hasAttribute('tabindex')).toBe(false);
  });
});
