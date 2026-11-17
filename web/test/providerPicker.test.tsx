// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderPicker } from '../src/features/providers/index.ts';
import type { ProviderView } from '../src/shared/api/types.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { fakeApi } from './fixtures.ts';
import { accessState, providersView, providerView } from './providerFixtures.ts';

afterEach(cleanup);

const providers: ProviderView[] = [
  providerView('off', { name: 'Gamma', enabled: false, status: 'disabled' }),
  providerView('zai', {
    name: 'Z.ai',
    status: 'unavailable',
    access: [
      {
        ...accessState({ available: false, reasons: ['command claude not found'] }),
        models: {},
      },
    ],
  }),
  providerView('openai', { name: 'OpenAI' }),
];

let counter = 0;

function Host({
  initial = null,
  emptyLabel,
  api = fakeApi(),
  onValue,
}: {
  initial?: string | null;
  emptyLabel?: string;
  api?: ReturnType<typeof fakeApi>;
  onValue?: (slug: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  const [repository] = useState(() => `/picker-${(counter += 1)}`);
  return (
    <ProviderPicker
      label="Provider"
      value={value}
      onChange={(slug) => {
        setValue(slug);
        onValue?.(slug);
      }}
      providers={providers}
      {...(emptyLabel ? { emptyLabel } : {})}
      repository={repository}
      api={api}
    />
  );
}

const open = () => fireEvent.click(screen.getByRole('combobox', { name: 'Provider' }));

describe('the provider combobox', () => {
  it('lists the providers with status, disabled last and not choosable', async () => {
    render(<Host />);
    open();
    const options = await screen.findAllByRole('option');
    const names = options.map((option) => option.textContent ?? '');
    expect(names[0]).toContain('Z.ai');
    expect(names[0]).toContain('Unavailable · command claude not found');
    expect(names[1]).toContain('OpenAI');
    expect(names[2]).toContain('Gamma');
    expect(options[2]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('searches by name and by slug', async () => {
    render(<Host />);
    open();
    const search = await screen.findByPlaceholderText('Name or slug');
    fireEvent.change(search, { target: { value: 'openai' } });
    expect(screen.getAllByRole('option').some((o) => o.textContent?.includes('OpenAI'))).toBe(true);
    expect(screen.queryByText('Z.ai')).toBeNull();
  });

  it('offers the empty choice only with a label', async () => {
    const onValue = vi.fn();
    render(<Host emptyLabel="Not chosen" onValue={onValue} />);
    expect(screen.getByRole('combobox', { name: 'Provider' }).textContent).toContain('Not chosen');
    open();
    fireEvent.click(await screen.findByRole('option', { name: /OpenAI/ }));
    expect(onValue).toHaveBeenLastCalledWith('openai');
    open();
    fireEvent.click(await screen.findByRole('option', { name: /Not chosen/ }));
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it('marks a slug that is not in the registry', () => {
    render(<Host initial="gone" />);
    const trigger = screen.getByRole('combobox', { name: 'Provider' });
    expect(trigger.textContent).toContain('gone');
    expect(trigger.textContent).toContain('unknown provider');
  });
});

describe('creating a provider from the combobox', () => {
  it('opens the form with the searched name and chooses the new provider after saving', async () => {
    const api = fakeApi({ providers: vi.fn(async () => providersView({ providers })) });
    const onValue = vi.fn();
    render(<Host api={api} onValue={onValue} />);
    open();
    fireEvent.change(await screen.findByPlaceholderText('Name or slug'), {
      target: { value: 'My Cloud' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Create provider…/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
      ).toBe('My Cloud'),
    );
    expect((within(dialog).getByLabelText('Slug') as HTMLInputElement).value).toBe('my-cloud');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Next' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    await waitFor(() => expect(onValue).toHaveBeenCalledWith('my-cloud'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('changes nothing when the dialog is closed without saving', async () => {
    const api = fakeApi({ providers: vi.fn(async () => providersView({ providers })) });
    const onValue = vi.fn();
    render(<Host api={api} onValue={onValue} />);
    open();
    fireEvent.click(await screen.findByRole('option', { name: /Create provider…/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onValue).not.toHaveBeenCalled();
    expect(api.writeProvider).not.toHaveBeenCalled();
  });
});
