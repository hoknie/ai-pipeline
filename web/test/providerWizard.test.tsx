// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPage } from '../src/features/providers/index.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { configView, fakeApi } from './fixtures.ts';
import { editorProvider, providersView, providerView, roleView } from './providerFixtures.ts';

afterEach(cleanup);

let counter = 0;

function mount(props: {
  selected: string;
  preset?: string | null;
  overrides?: Parameters<typeof fakeApi>[0];
  files?: Record<string, Record<string, unknown>>;
}) {
  counter += 1;
  const files = props.files ?? {};
  const roles = [roleView('think'), roleView('code')];
  const providers = Object.keys(files).map((slug) => providerView(slug, { name: slug }));
  const api = fakeApi({
    providers: vi.fn(async () => providersView({ roles, providers })),
    config: vi.fn(async () =>
      configView({
        providers: Object.entries(files).map(([slug, raw]) => editorProvider(slug, raw)),
      }),
    ),
    ...props.overrides,
  });
  const onSelect = vi.fn();
  render(
    <ProvidersPage
      api={api}
      repository={`/wizard-${counter}`}
      runs={[]}
      selected={props.selected}
      section={null}
      preset={props.preset ?? null}
      project={null}
      onSelect={onSelect}
    />,
  );
  return { api, onSelect };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));

describe('the form of a new provider', () => {
  it('goes through Name → Access → Models and saves a slug made of the name', async () => {
    const { api, onSelect } = mount({ selected: 'new' });
    const name = await screen.findByLabelText('Name');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Z.ai GLM' } });
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('zai-glm');
    next();
    expect(await screen.findByText('Access 1')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Kind' })).toBeTruthy();
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    const call = vi.mocked(api.writeProvider).mock.calls[0]!;
    expect(call[0]).toBe('zai-glm');
    expect(call[1]).toEqual({ name: 'Z.ai GLM', access: [{ kind: 'cli', runtime: 'claude' }] });
    expect(call[2]).toBeNull();
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  it('refuses a slug that is taken', async () => {
    mount({ selected: 'new', files: { zai: { name: 'Z.ai' } } });
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Zai' } });
    expect(await screen.findByText('This slug is taken')).toBeTruthy();
  });

  it('fills the Z.ai preset with names of variables only', async () => {
    mount({ selected: 'new', preset: 'zai' });
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe(
      'Z.ai GLM Coding Plan',
    );
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('zai');
    next();
    const key = (await screen.findByLabelText('Variable with the key')) as HTMLInputElement;
    expect(key.value).toBe('ZAI_API_KEY');
    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(screen.getByText('Access 2')).toBeTruthy();
  });

  it('refuses a value that is not a name of a variable', async () => {
    mount({ selected: 'new', preset: 'zai' });
    await screen.findByLabelText('Name');
    next();
    fireEvent.change(await screen.findByLabelText('Variable with the key'), {
      target: { value: 'sk-123 456' },
    });
    expect(await screen.findByText('A variable name is needed, not a key')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives the Anthropic preset models only for roles that exist', async () => {
    const { api } = mount({ selected: 'new', preset: 'anthropic' });
    await screen.findByLabelText('Name');
    next();
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    // the roles are think and code; the preset knows think → opus, code → sonnet
    expect(vi.mocked(api.writeProvider).mock.calls[0]?.[1]).toMatchObject({
      models: { think: 'opus', code: 'sonnet' },
    });
  });

  it('shows the error of the daemon at its field and goes to its step', async () => {
    mount({
      selected: 'new',
      preset: 'zai',
      overrides: {
        writeProvider: vi.fn(async () => ({
          ok: false as const,
          reason: 'invalid' as const,
          errors: [{ path: 'swarm.providers.zai.access[1].model_prefix', message: 'bad prefix' }],
        })),
      },
    });
    await screen.findByLabelText('Name');
    next();
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('bad prefix')).toBeTruthy();
    expect(screen.getByText('Access 1')).toBeTruthy();
  });
});

describe('the form of an existing provider', () => {
  const files = { zai: { name: 'Z.ai', access: [{ kind: 'cli', runtime: 'claude' }] } };

  it('shows all parts on one page with the slug read only', async () => {
    mount({ selected: 'zai', files });
    const form = await screen.findByRole('form', { name: 'Provider form' });
    expect((within(form).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Z.ai',
    );
    expect((within(form).getByLabelText('Slug') as HTMLInputElement).readOnly).toBe(true);
    expect(within(form).getByRole('heading', { name: 'Models' })).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('writes with the revision of the file', async () => {
    const { api } = mount({ selected: 'zai', files });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), {
      target: { value: 'Z.ai 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeProvider).toHaveBeenCalled());
    expect(vi.mocked(api.writeProvider).mock.calls[0]).toEqual([
      'zai',
      { name: 'Z.ai 2', access: [{ kind: 'cli', runtime: 'claude' }] },
      'zai-r1',
      'global',
    ]);
  });

  it('deletes after a confirmation', async () => {
    const { api, onSelect } = mount({ selected: 'zai', files });
    await screen.findByRole('form', { name: 'Provider form' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(api.deleteProvider).toHaveBeenCalledWith('zai', 'zai-r1', 'global'));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  it('lists the places that use the provider when the delete is refused', async () => {
    const { onSelect } = mount({
      selected: 'zai',
      files,
      overrides: {
        deleteProvider: vi.fn(async () => ({
          ok: false as const,
          reason: 'invalid' as const,
          errors: [{ path: 'swarm.chains.thinking', message: 'used' }],
          references: [{ chain: 'thinking', item: 1 }],
        })),
      },
    });
    await screen.findByRole('form', { name: 'Provider form' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('chain thinking, item 2')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
