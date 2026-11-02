// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValuesPicker, withValues, type PickerOption } from '../src/components/ValuesPicker.tsx';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(cleanup);

const OPTIONS: PickerOption[] = [
  { name: 'WebFetch', source: 'builtin' },
  { name: 'review', source: 'project', description: 'Проверка кода' },
  { name: 'review', source: 'global' },
];

function Harness({
  start = [],
  onChange,
  ...rest
}: { start?: string[]; onChange?: (values: string[]) => void } & Partial<
  Parameters<typeof ValuesPicker>[0]
>) {
  const [values, setValues] = useState(start);
  return (
    <ValuesPicker
      label="Skills"
      values={values}
      onChange={(next) => {
        setValues(next);
        onChange?.(next);
      }}
      {...rest}
    />
  );
}

const search = async () => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Skills' }));
  return screen.findByRole('combobox', { name: 'Search in Skills' });
};

describe('withValues', () => {
  it('trims, skips empty lines and duplicates', () => {
    expect(withValues(['a'], [' b ', '', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('ValuesPicker', () => {
  it('picks an option from a group, with the description', async () => {
    const onChange = vi.fn();
    render(<Harness options={OPTIONS} onChange={onChange} />);
    const input = await search();
    expect(screen.getByText('Built-in')).toBeTruthy();
    expect(screen.getByText('Проверка кода')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'проверка' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2); // the match and the free-input row
    fireEvent.click(options[0]!);
    expect(onChange).toHaveBeenLastCalledWith(['review']);
  });

  it('adds a typed value on Enter, once', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = await search();
    for (let i = 0; i < 2; i++) {
      fireEvent.change(input, { target: { value: 'npm run check' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Remove npm run check' })).toHaveLength(1);
  });

  it('does not offer a free value when not creatable', async () => {
    render(<Harness options={OPTIONS} creatable={false} />);
    const input = await search();
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('Nothing found')).toBeTruthy();
  });

  it('turns a pasted text into a chip per line', async () => {
    render(<Harness />);
    const input = await search();
    fireEvent.paste(input, { clipboardData: { getData: () => 'a\n\n b \r\na\nc' } });
    expect(
      screen.getAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Remove a', 'Remove b', 'Remove c']);
  });

  it('removes a chip with its button and the last one with Backspace', async () => {
    render(<Harness start={['a', 'b', 'c']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove b' }));
    const input = await search();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.queryByRole('button', { name: 'Remove c' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove a' })).toBeTruthy();
  });

  it('shows inherited values grey and without a remove button', () => {
    render(<Harness inherited={['WebFetch']} />);
    const chip = screen.getByText('from defaults').closest('[data-inherited]') as HTMLElement;
    expect(chip.textContent).toContain('WebFetch');
    expect(within(chip).queryByRole('button')).toBeNull();
  });

  it('shows the mark of a value', () => {
    render(<Harness start={['x']} mark={(value) => (value === 'x' ? 'not found' : null)} />);
    expect(screen.getByText('not found')).toBeTruthy();
  });

  it('shows the display text in the chip and the remove button, and in the list', async () => {
    const onChange = vi.fn();
    const options: PickerOption[] = [
      { name: 'q1', source: 'project', description: 'Модель' },
      { name: 'q2', source: 'project', description: 'API' },
    ];
    const titles: Record<string, string> = { q1: 'Модель', q2: 'API' };
    render(
      <Harness
        options={options}
        creatable={false}
        display={(id) => titles[id] ?? id}
        onChange={onChange}
      />,
    );
    const input = await search();
    fireEvent.change(input, { target: { value: 'api' } });
    const found = screen.getAllByRole('option');
    expect(found).toHaveLength(1);
    expect(found[0]!.textContent).toContain('API');
    expect(found[0]!.textContent).not.toContain('q2');
    fireEvent.click(found[0]!);
    expect(onChange).toHaveBeenLastCalledWith(['q2']);
    expect(screen.getByRole('button', { name: 'Remove API' })).toBeTruthy();
  });

  it('keeps a long chosen value inside the field and a long option whole', async () => {
    const long = 'д'.repeat(120);
    render(
      <Harness
        start={['q1']}
        options={[{ name: 'q1', source: 'project' }]}
        creatable={false}
        display={() => long}
        contentClassName="min-w-80"
      />,
    );
    const text = screen.getByTitle(long);
    expect(text.className).toContain('truncate');
    expect(screen.getByRole('button', { name: `Remove ${long}` })).toBeTruthy();
    await search();
    const option = screen.getByRole('option');
    const label = option.querySelector(`[title="${long}"]`)!;
    expect(label.textContent).toBe(long);
    expect(label.className).not.toContain('truncate');
    expect(label.className).toContain('line-clamp-3');
    expect(document.querySelector('[data-radix-popper-content-wrapper] > *')?.className).toContain(
      'min-w-80',
    );
  });
});
