// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { Api } from '../src/shared/api/api.ts';
import { DeliveryFields } from '../src/features/settings/DeliveryFields.tsx';
import { SettingsTarget } from '../src/features/settings/SettingsTarget.tsx';
import { cleanup, render, screen } from './render.tsx';

// The guard in setup.ts fails a test when a select switches between uncontrolled and controlled.
afterEach(cleanup);

describe('selects stay controlled', () => {
  it('SettingsTarget: no project chosen, then one chosen', () => {
    const props = {
      scope: 'project' as const,
      repositories: ['/work/a', '/work/b'],
      onSelectRepository: () => {},
      file: null,
    };
    const view = render(<SettingsTarget {...props} repository={null} />);
    view.rerender(<SettingsTarget {...props} repository="/work/a" />);
    expect(screen.getByText('/work/a')).toBeTruthy();
  });

  it('DeliveryFields: unknown mode, then a known one', () => {
    const api = {} as Api;
    const onReload = () => {};
    const view = render(
      <DeliveryFields
        api={api}
        config={null}
        onReload={onReload}
        effective={{ autoDeliver: true, deliveryMode: null }}
        idPrefix="t"
      />,
    );
    view.rerender(
      <DeliveryFields
        api={api}
        config={null}
        onReload={onReload}
        effective={{ autoDeliver: true, deliveryMode: 'worktree' }}
        idPrefix="t"
      />,
    );
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
  });
});
