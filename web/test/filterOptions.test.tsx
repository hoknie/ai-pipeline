// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { visibleOptions, type FilterOption } from '../src/shared/ui/forms/filters/FilterList.tsx';

describe('visibleOptions', () => {
  const options: FilterOption[] = [
    { value: 'a', label: 'app-only', keywords: 'app' },
    { value: 'b', label: 'lib-only', keywords: 'lib · app' },
    { value: 'c', label: 'plain' },
  ];

  it('finds an option by its keywords', () => {
    expect(visibleOptions(options, [], 'lib').map((option) => option.value)).toEqual(['b']);
    expect(visibleOptions(options, [], 'APP').map((option) => option.value)).toEqual(['a', 'b']);
  });

  it('still searches the label and works without keywords', () => {
    expect(visibleOptions(options, [], 'plain').map((option) => option.value)).toEqual(['c']);
    expect(visibleOptions(options, [], '')).toHaveLength(3);
  });
});

describe('visibleOptions of the filter «Provider»', () => {
  const providers: FilterOption[] = [
    { value: '__none', label: 'Not chosen', count: 1 },
    { value: 'zai', label: 'Z.ai GLM Coding Plan', hint: 'zai', count: 2 },
    { value: 'anthropic', label: 'Anthropic', hint: 'anthropic', count: 3 },
  ];

  it('finds a provider by its name and by its slug', () => {
    expect(visibleOptions(providers, [], 'glm').map((option) => option.value)).toEqual(['zai']);
    expect(visibleOptions(providers, [], 'ZAI').map((option) => option.value)).toEqual(['zai']);
  });
});
