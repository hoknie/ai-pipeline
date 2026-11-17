/** What a slug of a provider may be: the file name `providers/<slug>.yaml`. */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * A slug from a name: Cyrillic is transliterated, the text is lower-cased, dots and apostrophes
 * are dropped («Z.ai» → `zai`), any other run of characters becomes one `-`; the result starts
 * with a letter and has at most 32 characters. It may be empty.
 */
export function slugOf(name: string): string {
  const latin = [...name.toLowerCase()].map((char) => CYRILLIC[char] ?? char).join('');
  const text = latin
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return text;
}
