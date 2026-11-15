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
