// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { RowMeta } from '../src/features/queue/list/RowBadges.tsx';
import { cleanup, render, screen } from './render.tsx';
import { queueItem } from './fixtures.ts';

afterEach(cleanup);

const meta = (overrides: Record<string, unknown>) =>
  render(
    <RowMeta
      item={{ ...queueItem('q1', 'A', 1), provider: 'zai', ...overrides }}
      pipelines={null}
      now={0}
    />,
  );

describe('the provider mark of a queue row', () => {
  it('shows the human name with the slug in the hint', () => {
    meta({ providerName: 'Z.ai' });
    const badge = screen.getByLabelText('Provider: Z.ai (zai)');
    expect(badge.textContent).toBe('Z.ai');
    expect(badge.getAttribute('title')).toBe('zai');
  });

  it('shows the slug when the provider has no name', () => {
    meta({ providerName: null });
    expect(screen.getByLabelText('Provider: zai').textContent).toBe('@zai');
  });
});
