import { isValidSlug } from '../config/index.ts';

export function queueItemId(nowMillis: number, random: number): string {
  return `q${base36(nowMillis, 8)}${base36(random % 36 ** 3, 3)}`;
}

export function tagId(nowMillis: number, random: number): string {
  return `tg-${base36(nowMillis, 8)}${base36(random % 36 ** 3, 3)}`;
}

export const RUN_ID_LENGTH = 12;

function base36(value: number, width: number): string {
  return Math.floor(value).toString(36).padStart(width, '0').slice(-width);
}

export function runId(nowMillis: number, random: number): string {
  return base36(nowMillis, 8) + base36(random % 36 ** 4, 4);
}

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
  й: 'i',
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
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function slugify(title: string): string {
  let output = '';
  for (const character of title.toLowerCase()) {
    if (/[a-z0-9]/.test(character)) output += character;
    else if (character in CYRILLIC) output += CYRILLIC[character];
    else if (!output.endsWith('-')) output += '-';
  }
  let slug = output.replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(slug)) slug = `g-${slug}`;
  slug = slug.slice(0, 32).replace(/-+$/, '');
  return isValidSlug(slug) ? slug : 'group';
}

export function groupSlugs(titles: string[]): string[] {
  const slugs: string[] = [];
  for (const title of titles) {
    const base = slugify(title);
    let candidate = base;
    for (let counter = 2; slugs.includes(candidate); counter += 1) {
      const suffix = `-${counter}`;
      candidate = base.slice(0, 32 - suffix.length).replace(/-+$/, '') + suffix;
    }
    slugs.push(candidate);
  }
  return slugs;
}

export const RUN_TITLE_LIMIT = 60;
export const RUN_NAME_LIMIT = 40;
export const RUN_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** English-like kebab-case name of a run, transliterated from its title. */
export function runName(title: string): string {
  let output = '';
  for (const character of title.toLowerCase()) {
    if (/[a-z0-9]/.test(character)) output += character;
    else if (character in CYRILLIC) output += CYRILLIC[character];
    else if (!output.endsWith('-')) output += '-';
  }
  const name = output
    .replace(/^-+|-+$/g, '')
    .slice(0, RUN_NAME_LIMIT)
    .replace(/-+$/, '');
  return name || 'run';
}
