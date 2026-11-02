// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { TagLabel } from '../src/components/TagChip.tsx';
import { WorkflowBadge } from '../src/components/WorkflowBadge.tsx';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(() => cleanup());

describe('workflow badge', () => {
  it('has the accessible name and a tooltip on focus', async () => {
    render(<WorkflowBadge id="feature" />);
    const badge = screen.getByLabelText('Workflow: feature');
    expect(badge.textContent).toBe('feature');
    fireEvent.focus(badge);
    expect((await screen.findByRole('tooltip')).textContent).toContain('Workflow: feature');
  });

  it('differs from a tag: rectangular, monospace, with an icon', () => {
    render(
      <>
        <WorkflowBadge id="feature" />
        <TagLabel tag={{ id: 'auth', name: 'auth', color: 'blue' }} />
      </>,
    );
    const badge = screen.getByLabelText('Workflow: feature');
    expect(badge.className).toContain('rounded-md');
    expect(badge.className).not.toContain('rounded-full');
    expect(badge.className).toContain('font-mono');
    expect(badge.querySelector('svg')).toBeTruthy();
    expect(document.querySelector('[data-tag="auth"]')!.className).toContain('rounded-full');
  });

  it('is focusable by default and not when focusable is false', () => {
    const { rerender } = render(<WorkflowBadge id="feature" />);
    expect(screen.getByLabelText('Workflow: feature').getAttribute('tabindex')).toBe('0');
    rerender(<WorkflowBadge id="feature" focusable={false} />);
    expect(screen.getByLabelText('Workflow: feature').hasAttribute('tabindex')).toBe(false);
  });
});
