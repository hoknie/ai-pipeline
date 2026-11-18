// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigPicker,
  type ConfigChoice,
  SHARED_CHOICE,
} from '../src/features/repositories/index.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

const project = (slug: string): ConfigChoice => ({
  value: slug,
  level: slug === 'p03' ? 'project_over_global' : 'project',
  project: { path: `/work/${slug}`, slug, label: `proj-${slug}`, color: null },
});
const SHARED: ConfigChoice = { ...project('app'), value: SHARED_CHOICE, level: 'global' };
const many = Array.from({ length: 20 }, (_, i) => project(`p${String(i + 1).padStart(2, '0')}`));

function Host({
  choices,
  onOpen = vi.fn(),
  onChoose = vi.fn(),
}: {
  choices: ConfigChoice[];
  onOpen?: (path: string) => void;
  onChoose?: (value: string) => void;
}) {
  const [value, setValue] = useState(choices[0]!.value);
  return (
    <ConfigPicker
      choices={choices}
      active={choices.find((c) => c.value === value)!}
      onChoose={(next) => {
        onChoose(next);
        setValue(next);
      }}
      onOpen={onOpen}
    />
  );
}

const trigger = () => document.querySelector<HTMLElement>('[data-config-picker]')!;
const items = () =>
  Array.from(document.querySelectorAll('[data-config-choice]')).map((i) =>
    i.getAttribute('data-config-choice'),
  );
const open = async () => {
  fireEvent.click(trigger());
  await waitFor(() => expect(items().length).toBeGreaterThan(0));
};

describe('the picker of a configuration', () => {
  it('is a combobox that shows the chosen one in one row', () => {
    render(<Host choices={[SHARED, ...many]} />);
    expect(trigger().getAttribute('role')).toBe('combobox');
    expect(trigger().textContent).toBe('Shared');
    expect(items()).toEqual([]);
  });

  it('opens with the shared choice first, then the projects, with their levels', async () => {
    render(<Host choices={[SHARED, ...many]} />);
    await open();
    expect(items()).toEqual([SHARED_CHOICE, ...many.map((c) => c.value)]);
    expect(document.querySelector('[data-config-choice="p03"]')?.textContent).toContain(
      'Project · overrides shared',
    );
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('searches by name and keeps the shared choice', async () => {
    render(<Host choices={[SHARED, ...many]} />);
    await open();
    fireEvent.change(screen.getByPlaceholderText('Search projects…'), { target: { value: 'p1' } });
    await waitFor(() => expect(items()[0]).toBe(SHARED_CHOICE));
    expect(items()).toEqual([
      SHARED_CHOICE,
      ...many.map((c) => c.value).filter((value) => value.startsWith('p1')),
    ]);
    fireEvent.change(screen.getByPlaceholderText('Search projects…'), { target: { value: 'zzz' } });
    await waitFor(() => expect(items()).toEqual([SHARED_CHOICE]));
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('closes on a choice and reports it', async () => {
    const onChoose = vi.fn();
    render(<Host choices={[SHARED, ...many]} onChoose={onChoose} />);
    await open();
    fireEvent.click(document.querySelector('[data-config-choice="p05"]')!);
    expect(onChoose).toHaveBeenCalledWith('p05');
    await waitFor(() => expect(items()).toEqual([]));
    expect(trigger().textContent).toBe('proj-p05');
  });

  it('is driven by the keyboard: arrows, Enter, Escape', async () => {
    const onChoose = vi.fn();
    render(<Host choices={[SHARED, ...many]} onChoose={onChoose} />);
    await open();
    const input = screen.getByPlaceholderText('Search projects…');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]![0]).toMatch(/^p\d\d$/);
    await open();
    fireEvent.keyDown(screen.getByPlaceholderText('Search projects…'), { key: 'Escape' });
    await waitFor(() => expect(items()).toEqual([]));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('opens the chosen configuration in its project', () => {
    const onOpen = vi.fn();
    render(<Host choices={[SHARED, ...many]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Open in project/ }));
    expect(onOpen).toHaveBeenCalledWith('/work/app');
  });
});
