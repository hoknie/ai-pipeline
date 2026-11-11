// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepositoryMenu } from '../src/app/shell/menus/RepositoryMenu.tsx';
import '../src/shared/i18n/index.ts';

import { cleanup, fireEvent, render, screen } from './render.tsx';

afterEach(cleanup);

describe('RepositoryMenu without any repository', () => {
  it('offers to add one and opens the dialog', async () => {
    const onAdd = vi.fn(async () => undefined);
    render(
      <RepositoryMenu
        choice={{
          repositories: [],
          selected: null,
          waiting: new Map(),
          onSelect: () => undefined,
          onAdd,
          browse: async () => ({
            path: '/Users/me',
            parent: '/Users',
            home: '/Users/me',
            git: false,
            entries: [],
            truncated: false,
          }),
        }}
      />,
    );
    const button = screen.getByRole('button', { name: /Add repository|Добавить репозиторий/ });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
