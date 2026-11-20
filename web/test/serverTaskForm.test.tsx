// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { DeliveryFields } from '../src/features/queue/form/DeliveryFields.tsx';
import type { FormState } from '../src/features/queue/form/TaskFields.tsx';
import { markServerMode } from '../src/shared/api/http.ts';
import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(cleanup);

describe('the task form in the server mode', () => {
  it('offers only the branch delivery and does not fall back to worktree', () => {
    markServerMode();
    const state = {
      idPrefix: 't',
      locked: false,
      effective: { autoDeliver: null, deliveryMode: null },
      change: () => {},
    } as unknown as FormState;
    render(<DeliveryFields state={state} autoDeliverDefault={null} deliveryModeDefault={null} />);
    const select = screen.getByRole('combobox', { name: /delivery/i });
    expect(select.textContent?.toLowerCase()).not.toContain('worktree');
    fireEvent.click(select);
    const options = screen.queryAllByRole('option').map((option) => option.textContent);
    expect(options).toHaveLength(1);
    expect(options.join(' ').toLowerCase()).not.toMatch(/worktree|commit/);
  });
});
