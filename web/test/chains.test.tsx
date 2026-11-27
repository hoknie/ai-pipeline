// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';
import { modelValues } from './modelField.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';

import type { EditorChain } from '../src/shared/api/types.ts';
import { ModelCatalogProvider } from '../src/shared/lib/catalog/models.tsx';
import {
  defaultChainDraft,
  draftOfChain,
  sameChainDraft,
  valueOfChain,
} from '../src/features/specialists/chains/draft.ts';
import { ChainForm } from '../src/features/specialists/chains/ChainForm.tsx';
import { ChainsList } from '../src/features/specialists/chains/ChainsList.tsx';
import SpecialistsPage from '../src/features/specialists/SpecialistsPage.tsx';
import { SharedChainsGroup } from '../src/features/swarm/global/SharedChainsGroup.tsx';
import { configView, fakeApi, modelsView } from './fixtures.ts';
import { accessState, providersView, providerView, roleView } from './providerFixtures.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chainRaw = {
  name: 'Fast then Strong',
  mode: 'on_error',
  enabled: true,
  runtimes: [
    { runtime: 'claude', model: 'haiku', enabled: true },
    { runtime: 'opencode', model: 'gpt-4o', enabled: true },
  ],
};

const chainFixture: EditorChain = {
  slug: 'fast-to-strong',
  level: 'project',
  file: '/repo/aip/chains/fast-to-strong.yaml',
  revision: 'c1',
  raw: chainRaw,
  sources: {
    project: {
      file: '/repo/aip/chains/fast-to-strong.yaml',
      revision: 'c1',
      raw: chainRaw,
    },
  },
};

const sharedChain: EditorChain = {
  ...chainFixture,
  level: 'global',
  file: '/xdg/aip/chains/fast-to-strong.yaml',
  revision: null,
  sources: {
    global: {
      file: '/xdg/aip/chains/fast-to-strong.yaml',
      revision: 'g1',
      raw: chainFixture.raw,
    },
  },
};

describe('chain draft logic', () => {
  it.each(['model_role: think', 'model: proxy/A', 'model: role:think'])(
    'roundtrips source YAML through the form draft: %s',
    (selection) => {
      const raw = parse(
        `name: Thinking\nmode: on_error\nenabled: true\nruntimes:\n  - runtime: opencode\n    enabled: true\n    provider: proxy\n    ${selection}\n`,
      );
      const draft = draftOfChain({ ...chainFixture, raw });
      expect(parse(stringify(valueOfChain(draft, raw)))).toEqual(raw);
      const other = {
        ...draft,
        runtimes: draft.runtimes.map((item) => ({
          ...item,
          model_role: item.model_role ? 'code' : 'think',
        })),
      };
      expect(sameChainDraft(draft, other)).toBe(false);
    },
  );
  it('converts EditorChain to ChainDraft and back', () => {
    const draft = draftOfChain(chainFixture);
    expect(draft.slug).toBe('fast-to-strong');
    expect(draft.name).toBe('Fast then Strong');
    expect(draft.mode).toBe('on_error');
    expect(draft.runtimes).toHaveLength(2);
    expect(draft.runtimes[0]).toEqual({
      runtime: 'claude',
      model: 'haiku',
      model_role: '',
      variant: '',
      reasoning_effort: '',
      enabled: true,
      provider: '',
      default: false,
    });

    const value = valueOfChain(draft, chainFixture.raw);
    expect(value).toEqual({
      name: 'Fast then Strong',
      mode: 'on_error',
      enabled: true,
      runtimes: [
        { runtime: 'claude', model: 'haiku', enabled: true },
        { runtime: 'opencode', model: 'gpt-4o', enabled: true },
      ],
    });
  });

  it('detects changes with sameChainDraft', () => {
    const d1 = defaultChainDraft('test');
    const d2 = defaultChainDraft('test');
    expect(sameChainDraft(d1, d2)).toBe(true);
    const d3 = { ...d1, name: 'Changed' };
    expect(sameChainDraft(d1, d3)).toBe(false);
  });
});

describe('source role selection in chains', () => {
  const raw = {
    name: 'Thinking',
    mode: 'on_error',
    enabled: true,
    runtimes: [{ runtime: 'opencode', enabled: true, provider: 'proxy', model_role: 'think' }],
  };
  const entry = (source: Record<string, unknown> = raw): EditorChain => ({
    ...chainFixture,
    raw: source,
    sources: { project: { ...chainFixture.sources.project!, raw: source } },
  });
  function apiFor(model = 'A', roleName?: string) {
    return fakeApi({
      providers: vi.fn(async () =>
        providersView({
          roles: [roleView('think', roleName ?? 'Think'), roleView('code', roleName ?? 'Code')],
          providers: ['proxy', 'other'].map((slug) =>
            providerView(slug, {
              models: { think: { model }, code: { model } },
              access: [
                { ...accessState({ runtime: 'opencode', modelPrefix: 'proxy' }), models: {} },
              ],
            }),
          ),
        }),
      ),
    });
  }
  function mount(api = apiFor(), chain = entry(), onDirty = vi.fn()) {
    return render(
      <ModelCatalogProvider api={api}>
        <ChainForm
          api={api}
          chain={chain}
          onDirty={onDirty}
          onSaved={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
        />
      </ModelCatalogProvider>,
    );
  }
  const picker = () => screen.getByRole('combobox', { name: 'Model' });

  it('preserves a spaced fixed Claude ID after editing saved role YAML and renaming', async () => {
    const api = fakeApi({
      providers: vi.fn(async () =>
        providersView({
          roles: [roleView('think', 'Think')],
          providers: [providerView('proxy', { models: { think: { model: ' A ' } } })],
        }),
      ),
    });
    const role = {
      ...raw,
      runtimes: [{ runtime: 'claude', enabled: true, provider: 'proxy', model_role: 'think' }],
    };
    const form = (source: Record<string, unknown>) => (
      <ChainForm
        api={api}
        chain={entry(source)}
        onDirty={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
      />
    );
    const view = render(form(role));
    await waitFor(() => expect(picker().textContent).toContain('Think —  A '));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(chainFixture.slug, role, 'c1', 'project'),
    );
    const yaml = stringify(vi.mocked(api.writeChain).mock.calls[0]![1]);
    const fixedYaml = yaml.replace('model_role: think', 'model: " A "');
    expect(fixedYaml).not.toBe(yaml);
    const fixed = parse(fixedYaml);
    view.rerender(form(fixed));
    await waitFor(() => {
      expect(picker().dataset.value).toBe(' A ');
      expect(picker().textContent).not.toContain('Think');
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        chainFixture.slug,
        { ...fixed, name: 'Renamed' },
        'c1',
        'project',
      ),
    );
    expect(vi.mocked(api.writeChain).mock.calls[1]![1].runtimes).toEqual([
      { runtime: 'claude', enabled: true, provider: 'proxy', model: ' A ' },
    ]);
  });

  it('reloads edits of the saved YAML into the mounted form, from role to fixed model and back', async () => {
    const api = apiFor('A');
    const form = (chain: EditorChain) => (
      <ModelCatalogProvider api={api}>
        <ChainForm
          api={api}
          chain={chain}
          onDirty={vi.fn()}
          onSaved={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
        />
      </ModelCatalogProvider>
    );
    const view = render(form(entry()));
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(chainFixture.slug, raw, 'c1', 'project'),
    );
    const roleYaml = stringify(vi.mocked(api.writeChain).mock.calls[0]![1]);
    const fixedYaml = roleYaml.replace('model_role: think', 'model: proxy/A');
    expect(fixedYaml).not.toBe(roleYaml);
    const fixed = parse(fixedYaml);
    view.rerender(
      form({
        ...entry(fixed),
        sources: { project: { ...entry(fixed).sources.project!, revision: 'c2' } },
      }),
    );
    await waitFor(() => {
      expect(picker().textContent).toContain('proxy/A');
      expect(picker().textContent).not.toContain('Think');
      expect(picker().textContent).not.toContain('Code');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(chainFixture.slug, fixed, 'c2', 'project'),
    );
    const savedFixedYaml = stringify(vi.mocked(api.writeChain).mock.calls[1]![1]);
    expect(savedFixedYaml).not.toContain('model_role');
    const restoredYaml = savedFixedYaml.replace('model: proxy/A', 'model_role: think');
    expect(restoredYaml).not.toBe(savedFixedYaml);
    const restored = entry(parse(restoredYaml));
    view.rerender(
      form({ ...restored, sources: { project: { ...restored.sources.project!, revision: 'c3' } } }),
    );
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(chainFixture.slug, raw, 'c3', 'project'),
    );
    expect(stringify(vi.mocked(api.writeChain).mock.calls[2]![1])).toContain('model_role: think');
  });

  it('selects Think independently from Code with the same ID, saves and reopens the reference', async () => {
    const api = apiFor();
    mount(
      api,
      entry({
        ...raw,
        runtimes: [{ runtime: 'opencode', enabled: true, provider: 'proxy', model: 'proxy/A' }],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('combobox', { name: 'Provider' }).disabled).toBe(
        false,
      ),
    );
    expect(picker().textContent).toContain('proxy/A');
    expect(picker().textContent).not.toContain('Think');
    fireEvent.click(picker());
    const think = await screen.findByRole('option', { name: /Think — proxy\/A/ });
    const code = screen.getByRole('option', { name: /Code — proxy\/A/ });
    expect(think.getAttribute('data-value')).not.toBe(code.getAttribute('data-value'));
    fireEvent.click(code);
    fireEvent.click(picker());
    fireEvent.click(await screen.findByRole('option', { name: /Think — proxy\/A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(chainFixture.slug, raw, 'c1', 'project'),
    );
    const saved = vi.mocked(api.writeChain).mock.calls[0]![1];
    cleanup();
    mount(apiFor('B'), entry(saved));
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/B'));
    expect(picker().textContent).not.toContain('Code');
  });

  it('keeps a manually typed full model ID fixed instead of selecting the role with that slug', async () => {
    const api = apiFor();
    mount(api);
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    fireEvent.click(picker());
    fireEvent.change(await screen.findByPlaceholderText('Search or type a value…'), {
      target: { value: 'proxy/think' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Use.*proxy\/think/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        {
          ...raw,
          runtimes: [
            { runtime: 'opencode', enabled: true, provider: 'proxy', model: 'proxy/think' },
          ],
        },
        'c1',
        'project',
      ),
    );
  });

  it.each([false, true])(
    'keeps a manually typed spaced Claude ID fixed (catalogue A: %s)',
    async (catalogued) => {
      const api = apiFor();
      const catalog = modelsView();
      api.models = vi.fn(async () => ({
        ...catalog,
        runtimes: {
          ...catalog.runtimes,
          claude: {
            models: catalogued ? [{ id: 'A', name: 'A', group: 'aliases' }] : [],
            error: null,
          },
        },
      }));
      mount(
        api,
        entry({ ...raw, runtimes: [{ runtime: 'claude', enabled: true, provider: 'proxy' }] }),
      );
      fireEvent.click(picker());
      fireEvent.change(await screen.findByPlaceholderText('Search or type a value…'), {
        target: { value: ' A ' },
      });
      if (catalogued) expect(await screen.findByRole('option', { name: 'A' })).toBeTruthy();
      fireEvent.click(await screen.findByRole('option', { name: /Use.*A/ }));
      expect(picker().dataset.value).toBe(' A ');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenCalledWith(
          chainFixture.slug,
          {
            ...raw,
            runtimes: [{ runtime: 'claude', enabled: true, provider: 'proxy', model: ' A ' }],
          },
          'c1',
          'project',
        ),
      );
    },
  );

  it.each([
    { runtime: 'claude', provider: ' proxy ' },
    { runtime: 'unknown', provider: 'proxy' },
    { provider: 'proxy' },
  ])('preserves the invalid source route %j after renaming', async (route) => {
    const source = { ...raw, runtimes: [{ ...route, enabled: true, model_role: 'think' }] };
    const api = apiFor();
    // A real Claude route exists: normalizing the source would silently repair it.
    api.providers = vi.fn(async () =>
      providersView({
        roles: [roleView('think', 'Think')],
        providers: [providerView('proxy', { models: { think: { model: 'A' } } })],
      }),
    );
    mount(api, entry(source));
    await waitFor(() => expect(picker().getAttribute('aria-invalid')).toBe('true'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed invalid route' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        { ...source, name: 'Renamed invalid route' },
        'c1',
        'project',
      ),
    );
  });

  it('keeps a catalogue selection fixed when it has the same model ID as a role', async () => {
    const catalog = modelsView();
    const api = apiFor();
    api.models = vi.fn(async () => ({
      ...catalog,
      runtimes: {
        ...catalog.runtimes,
        opencode: { models: [{ id: 'proxy/A', name: 'proxy/A', group: 'proxy' }], error: null },
      },
    }));
    mount(api);
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    fireEvent.click(picker());
    fireEvent.click(await screen.findByRole('option', { name: 'proxy/A' }));
    expect(picker().textContent).not.toContain('Think');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        {
          ...raw,
          runtimes: [{ runtime: 'opencode', enabled: true, provider: 'proxy', model: 'proxy/A' }],
        },
        'c1',
        'project',
      ),
    );
    const saved = vi.mocked(api.writeChain).mock.calls[0]![1];
    cleanup();
    mount(apiFor('B'), entry(saved));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('combobox', { name: 'Provider' }).disabled).toBe(
        false,
      ),
    );
    expect(picker().textContent).toContain('proxy/A');
    expect(picker().textContent).not.toContain('Think');
    expect(picker().textContent).not.toContain('proxy/B');
  });

  it.each([null, '', '   ', 'proxy/A'])(
    'preserves the conflicting model %j after renaming until an explicit role selection',
    async (model) => {
      const source = { ...raw, runtimes: [{ ...raw.runtimes[0], model }] };
      const api = apiFor();
      mount(api, entry(source));
      await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed conflict' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenCalledWith(
          chainFixture.slug,
          { ...source, name: 'Renamed conflict' },
          'c1',
          'project',
        ),
      );
      const saved = vi.mocked(api.writeChain).mock.calls[0]![1];
      const item = (saved.runtimes as Record<string, unknown>[])[0]!;
      expect(Object.hasOwn(item, 'model')).toBe(true);
      expect(item.model).toBe(model);
      fireEvent.click(picker());
      fireEvent.click(await screen.findByRole('option', { name: /Code — proxy\/A/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenLastCalledWith(
          chainFixture.slug,
          {
            ...raw,
            name: 'Renamed conflict',
            runtimes: [{ ...raw.runtimes[0], model_role: 'code' }],
          },
          'c1',
          'project',
        ),
      );
    },
  );

  it.each([
    { reasoning_effort: 'high' },
    { variant: ' v1 ' },
    { variant: '', reasoning_effort: null },
    { variant: null, reasoning_effort: '' },
    { variant: 'v1', reasoning_effort: 'high' },
  ])('preserves unsupported Claude options %j after renaming', async (options) => {
    const source = {
      ...raw,
      runtimes: [{ ...raw.runtimes[0], runtime: 'claude', ...options }],
    };
    const api = apiFor();
    mount(api, entry(source));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed options' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        { ...source, name: 'Renamed options' },
        'c1',
        'project',
      ),
    );
  });

  it.each([
    { variant: '   ', reasoning_effort: null },
    { variant: 42, reasoning_effort: null },
    { variant: null, reasoning_effort: 42 },
    { variant: '', reasoning_effort: '' },
    { variant: ' v1 ', reasoning_effort: 'invalid' },
    { variant: 'v1', reasoning_effort: '__inherit' },
  ])('preserves explicit OpenCode options %j until each field is edited', async (options) => {
    const source = { ...raw, runtimes: [{ ...raw.runtimes[0], ...options }] };
    const api = apiFor();
    mount(api, entry(source));
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    if (options.reasoning_effort === '__inherit') {
      const effort = screen.getByRole('combobox', { name: 'Reasoning effort' });
      expect(effort.textContent).toBe('__inherit');
      expect(effort.getAttribute('aria-invalid')).toBe('true');
    }
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed options' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        chainFixture.slug,
        { ...source, name: 'Renamed options' },
        'c1',
        'project',
      ),
    );
    const saved = vi.mocked(api.writeChain).mock.calls[0]![1];
    expect((saved.runtimes as Record<string, unknown>[])[0]).toStrictEqual(source.runtimes[0]);

    // Explicit inheritance removes only this option, leaving the other source error intact.
    fireEvent.click(screen.getByRole('combobox', { name: 'Reasoning effort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        chainFixture.slug,
        {
          ...raw,
          name: 'Renamed options',
          runtimes: [{ ...raw.runtimes[0], variant: options.variant }],
        },
        'c1',
        'project',
      ),
    );
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'temporary' } });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        chainFixture.slug,
        { ...raw, name: 'Renamed options' },
        'c1',
        'project',
      ),
    );
    const inherited = vi.mocked(api.writeChain).mock.calls.at(-1)![1];
    const item = (inherited.runtimes as Record<string, unknown>[])[0]!;
    expect(Object.hasOwn(item, 'reasoning_effort')).toBe(false);
    expect(Object.hasOwn(item, 'variant')).toBe(false);
  });

  it.each([{ reasoning_effort: ['high'] }, { reasoning_effort: { toString: 1 } }])(
    'preserves non-string effort %j and repairs it with one high selection',
    async ({ reasoning_effort }) => {
      const source = {
        ...raw,
        runtimes: [{ ...raw.runtimes[0], variant: 'v1', reasoning_effort }],
      };
      const api = apiFor();
      mount(api, entry(source));
      const effort = screen.getByRole('combobox', { name: 'Reasoning effort' });
      expect(effort.getAttribute('aria-invalid')).toBe('true');
      expect(effort.textContent).toBe(Array.isArray(reasoning_effort) ? '(array)' : '(object)');
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed effort' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenLastCalledWith(
          chainFixture.slug,
          { ...source, name: 'Renamed effort' },
          'c1',
          'project',
        ),
      );
      const saved = vi.mocked(api.writeChain).mock.calls.at(-1)![1];
      expect((saved.runtimes as Record<string, unknown>[])[0]!.reasoning_effort).toStrictEqual(
        reasoning_effort,
      );
      fireEvent.click(effort);
      fireEvent.click(await screen.findByRole('option', { name: 'high' }));
      expect(effort.getAttribute('aria-invalid')).toBe('false');
      expect(effort.textContent).toBe('high');
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenLastCalledWith(
          chainFixture.slug,
          {
            ...source,
            name: 'Renamed effort',
            runtimes: [{ ...source.runtimes[0], reasoning_effort: 'high' }],
          },
          'c1',
          'project',
        ),
      );
    },
  );

  it.each(['variant', 'model', 'runtime'] as const)(
    'opens malformed %s objects and preserves them until explicit correction',
    async (field) => {
      const malformed = { toString: 1 };
      const source = { ...raw, runtimes: [{ ...raw.runtimes[0], [field]: malformed }] };
      const api = apiFor();
      mount(api, entry(source));
      if (field === 'variant') {
        expect(screen.getByLabelText('Variant').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText<HTMLInputElement>('Variant').value).toBe('(object)');
      } else if (field === 'runtime') {
        const runtime = screen.getByRole('combobox', { name: 'Runtime' });
        expect(runtime.getAttribute('aria-invalid')).toBe('true');
        expect(runtime.textContent).toBe('(object)');
      } else {
        expect(picker().getAttribute('aria-invalid')).toBe('true');
      }
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed object' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenLastCalledWith(
          chainFixture.slug,
          { ...source, name: 'Renamed object' },
          'c1',
          'project',
        ),
      );
      const saved = vi.mocked(api.writeChain).mock.calls.at(-1)![1];
      expect((saved.runtimes as Record<string, unknown>[])[0]![field]).toStrictEqual(malformed);
      if (field === 'variant') {
        fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'v1' } });
      } else if (field === 'runtime') {
        fireEvent.click(screen.getByRole('combobox', { name: 'Runtime' }));
        fireEvent.click(await screen.findByRole('option', { name: 'opencode' }));
      } else {
        await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
        fireEvent.click(picker());
        fireEvent.click(await screen.findByRole('option', { name: /Code — proxy\/A/ }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenLastCalledWith(
          chainFixture.slug,
          {
            ...raw,
            name: 'Renamed object',
            runtimes: [
              {
                ...raw.runtimes[0],
                ...(field === 'variant' ? { variant: 'v1' } : {}),
                ...(field === 'model' ? { model_role: 'code' } : {}),
              },
            ],
          },
          'c1',
          'project',
        ),
      );
    },
  );

  it('clears dirty after toggling an item without options off and back on', async () => {
    const onDirty = vi.fn();
    mount(apiFor(), entry(), onDirty);
    expect(onDirty).toHaveBeenLastCalledWith(false);
    const enabled = screen
      .getAllByRole('switch', { name: 'Enabled' })
      .find((el) => el.id === 'chain-item-0-enabled')!;
    fireEvent.click(enabled);
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(enabled);
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });

  it('clears dirty after restoring valid options but not after removing explicit null', async () => {
    const onDirty = vi.fn();
    mount(
      apiFor(),
      entry({
        ...raw,
        runtimes: [{ ...raw.runtimes[0], variant: 'v1', reasoning_effort: 'high' }],
      }),
      onDirty,
    );
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'v2' } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'v1' } });
    expect(onDirty).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('combobox', { name: 'Reasoning effort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'low' }));
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('combobox', { name: 'Reasoning effort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'high' }));
    expect(onDirty).toHaveBeenLastCalledWith(false);
    cleanup();
    onDirty.mockClear();
    const api = apiFor();
    mount(
      api,
      entry({ ...raw, runtimes: [{ ...raw.runtimes[0], reasoning_effort: null }] }),
      onDirty,
    );
    expect(onDirty).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('combobox', { name: 'Reasoning effort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'default' }));
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(chainFixture.slug, raw, 'c1', 'project'),
    );
  });

  it('clears unsupported options only after an intentional runtime selection', async () => {
    const source = {
      ...raw,
      runtimes: [
        { ...raw.runtimes[0], runtime: 'claude', variant: 'v1', reasoning_effort: 'high' },
      ],
    };
    const api = apiFor();
    mount(api, entry(source));
    fireEvent.click(screen.getByRole('combobox', { name: 'Runtime' }));
    fireEvent.click(await screen.findByRole('option', { name: 'opencode' }));
    expect(screen.getByLabelText('Variant')).toHaveProperty('value', 'v1');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        {
          ...raw,
          runtimes: [{ ...raw.runtimes[0], variant: 'v1', reasoning_effort: 'high' }],
        },
        'c1',
        'project',
      ),
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Runtime' }));
    fireEvent.click(await screen.findByRole('option', { name: 'claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        chainFixture.slug,
        { ...raw, runtimes: [{ ...raw.runtimes[0], runtime: 'claude' }] },
        'c1',
        'project',
      ),
    );
    // Switching back must not resurrect hidden source options.
    fireEvent.click(screen.getByRole('combobox', { name: 'Runtime' }));
    fireEvent.click(await screen.findByRole('option', { name: 'opencode' }));
    expect(screen.getByLabelText('Variant')).toHaveProperty('value', '');
  });

  it.each([42, null, ''])(
    'preserves invalid model_role %j when editing another field',
    async (model_role) => {
      const source = { ...raw, runtimes: [{ ...raw.runtimes[0], model_role }] };
      const api = apiFor();
      mount(api, entry(source));
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Renamed invalid role' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(api.writeChain).toHaveBeenCalledWith(
          chainFixture.slug,
          { ...source, name: 'Renamed invalid role' },
          'c1',
          'project',
        ),
      );
    },
  );

  it('disambiguates equal role names and models by slug and allows searching for the slug', async () => {
    const api = apiFor('A', 'Same');
    mount(api);
    await waitFor(() => expect(picker().textContent).toContain('Same (think) — proxy/A'));
    fireEvent.click(picker());
    const think = await screen.findByRole('option', { name: /Same \(think\) — proxy\/A/ });
    const code = screen.getByRole('option', { name: /Same \(code\) — proxy\/A/ });
    expect(think.getAttribute('data-value')).not.toBe(code.getAttribute('data-value'));
    fireEvent.change(screen.getByPlaceholderText('Search or type a value…'), {
      target: { value: 'code' },
    });
    expect(screen.queryByRole('option', { name: /Same \(think\)/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Same \(code\) — proxy\/A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        { ...raw, runtimes: [{ ...raw.runtimes[0], model_role: 'code' }] },
        'c1',
        'project',
      ),
    );
  });

  it('moves the provider-change warning with its row and clears it on explicit Default selection', async () => {
    const api = apiFor();
    mount(
      api,
      entry({
        ...raw,
        runtimes: [
          raw.runtimes[0],
          { runtime: 'opencode', enabled: true, provider: 'proxy', model: 'proxy/fixed' },
        ],
      }),
    );
    const warning = 'Provider changed. Choose a role or a fixed model again.';
    await waitFor(() =>
      expect(
        screen.getAllByRole<HTMLButtonElement>('combobox', { name: 'Provider' })[0]!.disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getAllByRole('combobox', { name: 'Provider' })[0]!);
    fireEvent.click(await screen.findByRole('option', { name: /other/ }));
    expect(await screen.findByText(warning)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!);
    const providers = screen.getAllByRole<HTMLButtonElement>('combobox', { name: 'Provider' });
    expect(providers.map((button) => button.dataset.providerValue)).toEqual(['proxy', 'other']);
    const models = screen.getAllByRole('combobox', { name: 'Model' });
    expect(screen.getByText(warning).parentElement?.querySelector('#chain-item-1-provider')).toBe(
      providers[1],
    );
    expect(
      screen.getByText(warning).parentElement?.querySelector('#chain-item-0-provider'),
    ).toBeNull();
    fireEvent.click(models[1]!);
    fireEvent.click(await screen.findByRole('option', { name: 'Default' }));
    expect(screen.queryByText(warning)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        {
          ...raw,
          runtimes: [
            { runtime: 'opencode', enabled: true, provider: 'proxy', model: 'proxy/fixed' },
            { runtime: 'opencode', enabled: true, provider: 'other' },
          ],
        },
        'c1',
        'project',
      ),
    );
  });

  it('clears a role on provider change with a request to choose again', async () => {
    const api = apiFor();
    mount(api);
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Provider' }));
    fireEvent.click(await screen.findByRole('option', { name: /other/ }));
    expect(
      await screen.findByText('Provider changed. Choose a role or a fixed model again.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        {
          ...raw,
          runtimes: [{ runtime: 'opencode', enabled: true, provider: 'other' }],
        },
        'c1',
        'project',
      ),
    );
  });

  it('keeps an unresolved role on incompatible runtime and exposes validation feedback', async () => {
    const api = apiFor();
    mount(api);
    await waitFor(() => expect(picker().textContent).toContain('Think — proxy/A'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Runtime' }));
    fireEvent.click(await screen.findByRole('option', { name: 'claude' }));
    expect(await screen.findByText(/This role cannot be resolved/)).toBeTruthy();
    expect(picker().getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        {
          ...raw,
          runtimes: [{ runtime: 'claude', enabled: true, provider: 'proxy', model_role: 'think' }],
        },
        'c1',
        'project',
      ),
    );
  });

  it('keeps a removed role visible instead of converting it to a model', async () => {
    const api = fakeApi({
      providers: vi.fn(async () =>
        providersView({
          providers: [
            providerView('proxy', {
              models: { code: { model: 'A' } },
              access: [
                { ...accessState({ runtime: 'opencode', modelPrefix: 'proxy' }), models: {} },
              ],
            }),
          ],
          roles: [roleView('code', 'Code')],
        }),
      ),
    });
    mount(api);
    expect(await screen.findByText(/This role cannot be resolved/)).toBeTruthy();
    expect(picker().textContent).toContain('think');
    fireEvent.click(picker());
    fireEvent.click(await screen.findByRole('option', { name: /Code — proxy\/A/ }));
    expect(screen.queryByText(/This role cannot be resolved/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        { ...raw, runtimes: [{ ...raw.runtimes[0], model_role: 'code' }] },
        'c1',
        'project',
      ),
    );
  });
});

describe('ChainsList UI', () => {
  it('renders chains with mode and runtime count', () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    render(
      <ChainsList
        chains={[chainFixture]}
        loaded={true}
        selected={null}
        onNew={onNew}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Fast then Strong')).toBeTruthy();
    expect(screen.getByText(/fast-to-strong/)).toBeTruthy();
    fireEvent.click(screen.getByText('Fast then Strong'));
    expect(onSelect).toHaveBeenCalledWith('fast-to-strong');
  });
});

describe('ChainForm UI', () => {
  it('keeps each full model ID with its runtime when rows are reordered and saved', async () => {
    const full = {
      name: 'Qualified models',
      mode: 'on_error',
      enabled: true,
      runtimes: [
        { runtime: 'opencode', model: 'openai/gpt-custom', enabled: true },
        { runtime: 'opencode', model: 'OtherProvider/team/GPT-Custom', enabled: true },
      ],
    };
    const chain = {
      ...chainFixture,
      raw: full,
      sources: {
        ...chainFixture.sources,
        project: { ...chainFixture.sources.project!, raw: full },
      },
    };
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 'c2',
      file: '/f',
    }));
    render(
      <ChainForm
        api={fakeApi({ writeChain })}
        chain={chain}
        onDirty={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
      />,
    );
    expect(modelValues().filter((value) => value === 'openai/gpt-custom')).toHaveLength(1);
    expect(modelValues().filter((value) => value === 'OtherProvider/team/GPT-Custom')).toHaveLength(
      1,
    );
    const moveUp = screen.getAllByRole('button', { name: 'Move up' });
    fireEvent.click(moveUp[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as typeof full;
    expect(saved.runtimes.map((item) => item.model)).toEqual([
      'OtherProvider/team/GPT-Custom',
      'openai/gpt-custom',
    ]);
  });

  it('allows saving an existing project chain without changing its fields', async () => {
    const api = fakeApi();
    render(
      <ChainForm
        api={api}
        chain={chainFixture}
        onDirty={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chainFixture.slug,
        chainFixture.raw,
        'c1',
        'project',
      ),
    );
  });

  it('renders chain details and saves edits', async () => {
    const onSaved = vi.fn(async () => undefined);
    const onDeleted = vi.fn(async () => undefined);
    const onDirty = vi.fn();
    const writeChain = vi.fn(async () => ({ ok: true as const, revision: 'c2', file: '/f' }));
    const api = fakeApi({ writeChain });

    render(
      <ChainForm
        api={api}
        chain={chainFixture}
        onDirty={onDirty}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />,
    );

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Fast then Strong');
    fireEvent.change(nameInput, { target: { value: 'Renamed Chain' } });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(writeChain).toHaveBeenCalledWith(
        'fast-to-strong',
        expect.objectContaining({ name: 'Renamed Chain' }),
        'c1',
        'project',
      );
    });
  });
});

describe('SpecialistsPage with Chains tab', () => {
  it('views shared chains read-only and creates and removes a project override', async () => {
    let current = sharedChain;
    const api = fakeApi({
      config: vi.fn(async () => configView({ chains: [current] })),
      writeChain: vi.fn(async (_slug, value) => {
        current = {
          ...sharedChain,
          ...chainFixture,
          level: 'project_over_global',
          raw: value,
          sources: {
            ...sharedChain.sources,
            project: { ...chainFixture.sources.project!, raw: value },
          },
        };
        return { ok: true as const, revision: 'c1', file: current.file };
      }),
      deleteChain: vi.fn(async () => {
        current = sharedChain;
        return { ok: true as const, revision: null, file: chainFixture.file };
      }),
    });
    render(
      <SpecialistsPage api={api} selected={sharedChain.slug} section="chains" onSelect={vi.fn()} />,
    );

    const name = await screen.findByLabelText<HTMLInputElement>('Name');
    expect(name.disabled).toBe(true);
    expect(screen.getAllByRole<HTMLInputElement>('textbox').every((f) => f.disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete chain' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add runtime' }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Override in the project' }));

    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        sharedChain.slug,
        sharedChain.raw,
        null,
        'project',
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(false),
    );
    expect(screen.queryByRole('button', { name: 'Override in the project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the override' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the override' }));
    await waitFor(() =>
      expect(api.deleteChain).toHaveBeenCalledWith(sharedChain.slug, 'c1', 'project'),
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true),
    );
  });

  it('creates new chains only in the project', async () => {
    const api = fakeApi();
    render(<SpecialistsPage api={api} selected="new" section="chains" onSelect={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'project-chain' } });
    expect(screen.queryByText('Global', { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        'project-chain',
        expect.any(Object),
        null,
        'project',
      ),
    );
  });

  it('switches between specialists and chains tabs', async () => {
    const onSelect = vi.fn();
    const api = fakeApi({
      config: vi.fn(async () => configView({ chains: [chainFixture] })),
    });

    const { rerender } = render(
      <SpecialistsPage api={api} selected={null} section={null} onSelect={onSelect} />,
    );

    expect(await screen.findByRole('button', { name: 'New specialist' })).toBeTruthy();

    rerender(<SpecialistsPage api={api} selected={null} section="chains" onSelect={onSelect} />);

    expect(screen.getAllByRole('button', { name: 'New chain' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fast then Strong').length).toBeGreaterThan(0);
  });
});

describe('shared chains in Settings', () => {
  it('loads the model catalog and offers models in the chain elements', async () => {
    const api = fakeApi();
    render(
      <SharedChainsGroup
        api={api}
        config={configView({ chains: [sharedChain] })}
        selected={sharedChain.slug}
        dirty={{ current: false }}
        onSelect={vi.fn()}
        onReload={vi.fn(async () => undefined)}
      />,
    );
    await waitFor(() => expect(api.models).toHaveBeenCalled());
    const pickers = await screen.findAllByRole('combobox', { name: 'Model' });
    fireEvent.click(pickers[0]!);
    expect(await screen.findByRole('option', { name: 'sonnet' })).toBeTruthy();
  });

  it('saves an existing shared chain with its own revision, including the next save', async () => {
    const api = fakeApi();
    const props = {
      api,
      selected: sharedChain.slug,
      dirty: { current: false },
      onSelect: vi.fn(),
      onReload: vi.fn(async () => undefined),
    };
    const { rerender } = render(
      <SharedChainsGroup {...props} config={configView({ chains: [sharedChain] })} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        sharedChain.slug,
        expect.objectContaining({ name: 'First save' }),
        'g1',
        'global',
      ),
    );
    const raw = { ...sharedChain.raw, name: 'First save' };
    const updated: EditorChain = {
      ...sharedChain,
      raw,
      sources: { global: { ...sharedChain.sources.global!, raw, revision: 'g2' } },
    };
    rerender(<SharedChainsGroup {...props} config={configView({ chains: [updated] })} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Second save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenLastCalledWith(
        sharedChain.slug,
        expect.objectContaining({ name: 'Second save' }),
        'g2',
        'global',
      ),
    );
  });

  it('edits the shared source even when the project overrides it', async () => {
    const projectRaw = { ...chainFixture.raw, name: 'Project override', mode: 'random' };
    const chain: EditorChain = {
      ...chainFixture,
      level: 'project_over_global',
      raw: projectRaw,
      sources: {
        ...sharedChain.sources,
        project: { ...chainFixture.sources.project!, raw: projectRaw },
      },
    };
    const api = fakeApi();
    render(
      <SharedChainsGroup
        api={api}
        config={configView({ chains: [chain] })}
        selected={chain.slug}
        dirty={{ current: false }}
        onSelect={vi.fn()}
        onReload={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Fast then Strong');
    expect(screen.queryByText('Project override')).toBeNull();
    expect(screen.getByText(sharedChain.file)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Shared edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.writeChain).toHaveBeenCalledWith(
        chain.slug,
        { ...sharedChain.raw, name: 'Shared edit' },
        'g1',
        'global',
      ),
    );
  });
});

const tierRaw = {
  name: 'Thinking',
  mode: 'by_provider',
  enabled: true,
  runtimes: [
    { runtime: 'claude', model: 'opus', enabled: true, provider: 'anthropic' },
    { runtime: 'opencode', model: 'zai/glm-5.3', enabled: true, provider: 'zai', default: true },
  ],
};

const tierFixture: EditorChain = {
  slug: 'thinking',
  level: 'project',
  file: '/repo/aip/chains/thinking.yaml',
  revision: 't1',
  raw: tierRaw,
  sources: { project: { file: '/repo/aip/chains/thinking.yaml', revision: 't1', raw: tierRaw } },
};

const providerButtons = () =>
  screen.getAllByRole<HTMLButtonElement>('combobox', { name: 'Provider' });

/** The API of a project with the providers `anthropic` «Anthropic» and `zai` «Z.ai». */
function registryApi(overrides: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    providers: vi.fn(async () =>
      providersView({
        providers: [
          providerView('anthropic', { name: 'Anthropic' }),
          providerView('zai', { name: 'Z.ai' }),
        ],
      }),
    ),
    ...overrides,
  });
}

function renderTier(api = fakeApi()) {
  render(
    <ChainForm
      api={api}
      chain={tierFixture}
      onDirty={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
    />,
  );
  return api;
}

describe('a chain in the By provider mode', () => {
  it('reads provider and default into the draft and writes them back', () => {
    const draft = draftOfChain(tierFixture);
    expect(draft.mode).toBe('by_provider');
    expect(draft.runtimes.map((item) => [item.provider, item.default])).toEqual([
      ['anthropic', false],
      ['zai', true],
    ]);
    expect(valueOfChain(draft, tierRaw)).toEqual(tierRaw);
  });

  it('keeps provider and drops default when the mode is not By provider', () => {
    const draft = { ...draftOfChain(tierFixture), mode: 'on_error' as const };
    const value = valueOfChain(draft) as { runtimes: Record<string, unknown>[] };
    expect(value.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai']);
    expect(value.runtimes.every((item) => !('default' in item))).toBe(true);
  });

  it('labels the mode By provider and not with the word level', () => {
    render(
      <ChainsList
        chains={[tierFixture]}
        loaded={true}
        selected={null}
        onNew={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/thinking · By provider · 2/)).toBeTruthy();
  });

  it('shows the provider fields and one Default switch at a time, and saves the file shape', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 't2',
      file: '/f',
    }));
    renderTier(registryApi({ writeChain }));
    await waitFor(() => expect(providerButtons().every((button) => !button.disabled)).toBe(true));
    expect(providerButtons().map((button) => button.dataset.providerValue)).toEqual([
      'anthropic',
      'zai',
    ]);
    expect(providerButtons().map((button) => button.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Z.ai')]),
    );
    const switches = screen.getAllByRole('switch', { name: 'Default' });
    expect(switches.map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    fireEvent.click(switches[0]!);
    expect(
      screen
        .getAllByRole('switch', { name: 'Default' })
        .map((el) => el.getAttribute('aria-checked')),
    ).toEqual(['true', 'false']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as typeof tierRaw & {
      runtimes: Record<string, unknown>[];
    };
    expect(saved.mode).toBe('by_provider');
    expect(saved.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai']);
    expect(saved.runtimes.map((item) => 'default' in item)).toEqual([true, false]);
  });

  it('removes default from the items when the mode changes', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      revision: 't2',
      file: '/f',
    }));
    renderTier(fakeApi({ writeChain }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Execution mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'On error' }));
    expect(screen.queryByRole('switch', { name: 'Default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writeChain).toHaveBeenCalled());
    const saved = writeChain.mock.calls[0]?.[1] as {
      mode: string;
      runtimes: Record<string, unknown>[];
    };
    expect(saved.mode).toBe('on_error');
    expect(saved.runtimes.map((item) => item.provider)).toEqual(['anthropic', 'zai']);
    expect(saved.runtimes.some((item) => 'default' in item)).toBe(false);
  });

  it('shows a validation error at the provider field of the item', async () => {
    const writeChain = vi.fn(async (..._args: unknown[]) => ({
      ok: false as const,
      reason: 'invalid' as const,
      errors: [
        {
          file: '/f',
          path: 'swarm.chains.thinking.runtimes[1].provider',
          message: 'duplicate provider `zai`',
        },
      ],
    }));
    renderTier(registryApi({ writeChain }));
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    fireEvent.click(providerButtons()[0]!);
    fireEvent.click(await screen.findByRole('option', { name: /Z\.ai/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const message = await screen.findByText('duplicate provider `zai`');
    expect(message.closest('div')?.querySelector('#chain-item-1-provider')).not.toBeNull();
    expect(screen.getAllByText('duplicate provider `zai`')).toHaveLength(1);
  });

  it('shows a provider that is not in the registry with a note', async () => {
    const api = fakeApi({
      providers: vi.fn(async () =>
        providersView({ providers: [providerView('zai', { name: 'Z.ai' })] }),
      ),
    });
    renderTier(api);
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    const old = providerButtons()[0]!;
    expect(old.dataset.providerValue).toBe('anthropic');
    expect(old.textContent).toContain('unknown provider');
  });

  it('offers «No provider» outside the By provider mode', async () => {
    renderTier(registryApi());
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    fireEvent.click(screen.getByRole('combobox', { name: 'Execution mode' }));
    fireEvent.click(await screen.findByRole('option', { name: 'On error' }));
    fireEvent.click(providerButtons()[0]!);
    expect(await screen.findByRole('option', { name: /No provider/ })).toBeTruthy();
  });

  it('creates a provider from the combobox of an item and chooses it', async () => {
    const created: Record<string, unknown>[] = [];
    const providers = vi.fn(async () =>
      providersView({
        providers: [
          providerView('anthropic', { name: 'Anthropic' }),
          ...created.map((value) => providerView('corp', { name: String(value.name) })),
        ],
      }),
    );
    const writeProvider = vi.fn(async (_slug: string, value: Record<string, unknown>) => {
      created.push(value);
      return { ok: true as const, revision: 'n', file: '/f' };
    });
    renderTier(fakeApi({ providers, writeProvider, config: vi.fn(async () => configView()) }));
    await waitFor(() => expect(providerButtons()[1]!.disabled).toBe(false));
    fireEvent.click(providerButtons()[1]!);
    fireEvent.change(await screen.findByPlaceholderText('Name or slug'), {
      target: { value: 'Corp' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Create provider/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New provider' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Corp');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(writeProvider).toHaveBeenCalledWith('corp', expect.anything(), null, 'project'),
    );
    await waitFor(() => expect(providerButtons()[1]!.dataset.providerValue).toBe('corp'));
  });
});

describe('shared chains and the roles of providers', () => {
  const sharedTier: EditorChain = {
    ...tierFixture,
    level: 'global',
    file: '/xdg/aip/chains/thinking.yaml',
    revision: null,
    sources: {
      global: { file: '/xdg/aip/chains/thinking.yaml', revision: 'g1', raw: tierRaw },
    },
  };

  it('offers only the shared providers in the combobox of a shared chain', async () => {
    const providers = vi.fn(async (level?: 'global') =>
      providersView({
        providers:
          level === 'global'
            ? [providerView('anthropic', { name: 'Anthropic' })]
            : [providerView('local', { name: 'Local' })],
      }),
    );
    render(
      <SharedChainsGroup
        api={fakeApi({ providers })}
        config={configView({ chains: [sharedTier] })}
        selected="thinking"
        dirty={{ current: false }}
        onSelect={vi.fn()}
        onReload={vi.fn(async () => undefined)}
      />,
    );
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    expect(providers).toHaveBeenCalledWith('global');
    fireEvent.click(providerButtons()[0]!);
    expect(await screen.findByRole('option', { name: /Anthropic/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Local/ })).toBeNull();
  });

  const withRoles = () =>
    fakeApi({
      providers: vi.fn(async () =>
        providersView({
          roles: [roleView('think', 'Think'), roleView('light', 'Light')],
          providers: [
            providerView('anthropic', {
              name: 'Anthropic',
              models: { think: { model: 'opus' } } as never,
            }),
            providerView('zai', { name: 'Z.ai', models: { think: { model: 'glm' } } as never }),
          ],
        }),
      ),
    });

  it('puts the models of the roles of the provider first in the model choice of an item', async () => {
    const api = withRoles();
    render(
      <ModelCatalogProvider api={api}>
        <ChainForm
          api={api}
          chain={tierFixture}
          onDirty={vi.fn()}
          onSaved={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
        />
      </ModelCatalogProvider>,
    );
    await waitFor(() => expect(providerButtons()[0]!.disabled).toBe(false));
    expect(screen.getAllByRole('combobox', { name: 'Model' })[0]!.textContent).not.toContain(
      'Think',
    );
    fireEvent.click(screen.getAllByRole('combobox', { name: 'Model' })[0]!);
    const heading = await screen.findByText('Roles of the provider');
    const option = await screen.findByRole('option', { name: /Think — opus/ });
    const list = screen.getByRole('listbox');
    const headings = Array.from(list.querySelectorAll('[cmdk-group-heading]'));
    expect(headings[0]).toBe(heading);
    const options = within(list).getAllByRole('option');
    expect(options[0]!.textContent).toBe('Default');
    expect(options[1]).toBe(option);
    const catalogueOptions = options
      .slice(2)
      .filter((item) => item.dataset.value?.startsWith('model:'));
    expect(catalogueOptions.length).toBeGreaterThan(0);
    expect(headings.length).toBeGreaterThan(1);
    fireEvent.click(option);
    expect(screen.getAllByRole('combobox', { name: 'Model' })[0]!.dataset.value).toBe('opus');
    expect(screen.getAllByRole('combobox', { name: 'Model' })[0]!.textContent).toContain(
      'Think — opus',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeChain).toHaveBeenCalled());
    expect(vi.mocked(api.writeChain).mock.calls[0]![1].runtimes).toEqual([
      { runtime: 'claude', enabled: true, provider: 'anthropic', model_role: 'think' },
      tierRaw.runtimes[1],
    ]);
  });

  it('gives no role models when the provider has no access for the runtime of the item', async () => {
    renderTier(withRoles());
    await waitFor(() => expect(providerButtons()[1]!.disabled).toBe(false));
    // the second item runs `zai` through opencode, and `zai` has only a claude access
    fireEvent.click(screen.getAllByRole('combobox', { name: 'Model' })[1]!);
    await screen.findByRole('listbox');
    expect(screen.queryByText('Roles of the provider')).toBeNull();
  });
});
