import type { TagColor } from '../../api/types.ts';

/**
 * Classes of a tag chip per palette color: a light and a dark pair of shades. The pairs are
 * written out in full so Tailwind finds them; the text/background contrast is at least 4.5:1.
 */
export const TAG_CLASSES: Record<TagColor, string> = {
  indigo: 'bg-[#e0e7ff] text-[#312e81] dark:bg-[#312e81] dark:text-[#e0e7ff]',
  gray: 'bg-[#f3f4f6] text-[#111827] dark:bg-[#111827] dark:text-[#f3f4f6]',
  red: 'bg-[#fee2e2] text-[#7f1d1d] dark:bg-[#7f1d1d] dark:text-[#fee2e2]',
  orange: 'bg-[#ffedd5] text-[#7c2d12] dark:bg-[#7c2d12] dark:text-[#ffedd5]',
  yellow: 'bg-[#fef9c3] text-[#713f12] dark:bg-[#713f12] dark:text-[#fef9c3]',
  green: 'bg-[#dcfce7] text-[#14532d] dark:bg-[#14532d] dark:text-[#dcfce7]',
  teal: 'bg-[#ccfbf1] text-[#134e4a] dark:bg-[#134e4a] dark:text-[#ccfbf1]',
  blue: 'bg-[#dbeafe] text-[#1e3a8a] dark:bg-[#1e3a8a] dark:text-[#dbeafe]',
  violet: 'bg-[#ede9fe] text-[#4c1d95] dark:bg-[#4c1d95] dark:text-[#ede9fe]',
  pink: 'bg-[#fce7f3] text-[#831843] dark:bg-[#831843] dark:text-[#fce7f3]',
  brown: 'bg-[#fef3c7] text-[#78350f] dark:bg-[#78350f] dark:text-[#fef3c7]',
};

/** The color reserved for tags of linked tasks; it is not offered when choosing a color. */
export const LINKED_TAG_COLOR: TagColor = 'indigo';

export const TAG_COLOR_NAMES = (Object.keys(TAG_CLASSES) as TagColor[]).filter(
  (color) => color !== LINKED_TAG_COLOR,
);
