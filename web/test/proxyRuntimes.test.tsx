import { describe, expect, it } from 'vitest';

import { RUNTIMES } from '../src/features/specialists/form/fieldInputs.tsx';
import { draftOfChain, valueOfChain } from '../src/features/specialists/chains/draft.ts';
import { modelsOf } from '../src/shared/lib/catalog/models.tsx';
import { groupOf } from '../src/shared/lib/nav/settingsGroups.ts';
import { SETTINGS_SECTIONS } from '../src/shared/ui/forms/settings/settingFields.ts';
import { selectorProblem } from '../src/shared/ui/forms/settings/poolsDraft.ts';
import { modelsView } from './fixtures.ts';

const NEW = ['codex', 'kilo', 'cline', 'copilot'] as const;

describe('the four CLIs in the panel', () => {
  it('offers them after the old three in a specialist form', () => {
    expect(RUNTIMES).toEqual(['claude', 'opencode', 'agy', ...NEW]);
  });

  it.each(NEW)('keeps %s in a chain without OpenCode-only fields', (runtime) => {
    const draft = draftOfChain({
      slug: 'pair',
      raw: { name: 'Pair', mode: 'on_error', runtimes: [{ runtime, model: 'm', variant: 'x' }] },
    } as never);
    expect(draft.runtimes[0]?.runtime).toBe(runtime);
    const value = valueOfChain(draft) as { runtimes: Record<string, unknown>[] };
    expect(value.runtimes[0]).toEqual({ runtime, enabled: true, model: 'm' });
  });

  it('falls back to claude for an unknown runtime of an old chain', () => {
    const draft = draftOfChain({
      slug: 'pair',
      raw: { name: 'Pair', mode: 'on_error', runtimes: [{ runtime: 'cursor' }] },
    } as never);
    expect(draft.runtimes[0]?.runtime).toBe('claude');
  });

  it.each(NEW)(
    'has a card of %s in the runtimes group without the value of the variables',
    (name) => {
      const sections = SETTINGS_SECTIONS.runtimes ?? [];
      const section = sections.find((entry) => entry.key === name);
      expect(section?.paths).toEqual([
        `runtimes.${name}.enabled`,
        `runtimes.${name}.command`,
        `runtimes.${name}.args`,
        `runtimes.${name}.env`,
      ]);
      expect(groupOf(`runtimes.${name}.env`)).toBe('runtimes');
    },
  );

  it('shows an empty model list of a new CLI as a free field, not the catalog of Claude', () => {
    const catalog = modelsView();
    for (const name of NEW) expect(modelsOf(catalog, name)).toEqual({ models: [], error: null });
    expect(modelsOf(catalog, 'cursor')).toBeNull();
    expect(modelsOf(null, 'codex')).toBeNull();
  });

  it('takes the new names as selectors of a queue pool and refuses an unknown one', () => {
    for (const name of NEW) expect(selectorProblem(name)).toBeNull();
    expect(selectorProblem('cursor')).toBe('format');
  });
});
