// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepositoryMenu } from '../src/components/shell/RepositoryMenu.tsx';
import '../src/i18n/index.ts';

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
          home: null,
          onSelect: () => undefined,
          onAdd,
          onRemove: () => undefined,
        }}
      />,
    );
    const button = screen.getByRole('button', { name: /Add repository|Добавить репозиторий/ });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
