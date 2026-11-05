// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { files, when } from '../src/format.ts';
import { applyStoredLanguage, detectLanguage, LANGUAGES } from '../src/i18n/index.ts';
import { en } from '../src/i18n/locales/en.ts';
import { es } from '../src/i18n/locales/es.ts';
import { ru } from '../src/i18n/locales/ru.ts';
import { zh } from '../src/i18n/locales/zh.ts';
import type { Dictionary } from '../src/i18n/types.ts';

import { FakeEventSource, configView, fakeApi, groupView, openFake, runView } from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

// What the dictionary type lets through and what it stops; checked by `tsc -p web/tsconfig.json`.
export const pluralForm: Dictionary = {
  ...ru,
  format: { ...ru.format, files_few: '{{count}} файла' },
};
export const unknownKey: Dictionary = {
  ...ru,
  nav: {
    ...ru.nav,
    // @ts-expect-error a key the reference does not have
    bogus: 'x',
  },
};
export const pluralFormOfPlainKey: Dictionary = {
  ...ru,
  common: {
    ...ru.common,
    // @ts-expect-error `close` is not a plural key
    close_few: 'x',
  },
};

function setBrowserLanguages(languages: string[]): void {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
}

function mount(runs = [runView()]) {
  const api = fakeApi({
    group: vi.fn(async () => groupView()),
    config: vi.fn(async () => configView()),
  });
  render(<App api={api} openStream={openFake} />);
  act(() => FakeEventSource.last!.send({ event: 'snapshot', seq: 1, runs }));
  return api;
}

function openLanguageMenu(): void {
  fireEvent.keyDown(screen.getByRole('button', { name: /^(Language|Язык|Idioma|语言)/ }), {
    key: 'Enter',
  });
}

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => cleanup());

describe('language of the browser', () => {
  it.each([
    [['es-MX', 'en-US'], 'es'],
    [['de-DE', 'fr-FR'], 'en'],
    [['de-DE', 'ru-RU'], 'ru'],
    [['zh-TW'], 'zh'],
    [[], 'en'],
  ])('%j gives %s', (languages, language) => {
    expect(detectLanguage(languages)).toBe(language);
  });

  it('starts in English in tests', () => {
    expect(i18next.language).toBe('en');
  });

  it('opens the panel in Spanish for a Spanish browser', () => {
    setBrowserLanguages(['es-MX', 'en-US']);
    applyStoredLanguage();
    mount();
    expect(document.documentElement.lang).toBe('es');
    expect(screen.getByRole('link', { name: /Ejecuciones/ })).toBeTruthy();
  });

  it('puts zh-CN into lang for traditional Chinese', () => {
    setBrowserLanguages(['zh-TW']);
    applyStoredLanguage();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(i18next.language).toBe('zh');
  });

  it('puts the browser language into lang', () => {
    setBrowserLanguages(['ru-RU']);
    applyStoredLanguage();
    expect(document.documentElement.lang).toBe('ru');
  });

  it('reads a damaged saved value as «as in the browser»', () => {
    window.localStorage.setItem('aip.web.language', '"klingon"');
    setBrowserLanguages(['ru-RU']);
    applyStoredLanguage();
    expect(i18next.language).toBe('ru');
    window.localStorage.setItem('aip.web.language', 'not json');
    setBrowserLanguages(['es-ES']);
    applyStoredLanguage();
    expect(i18next.language).toBe('es');
  });

  it('follows a change of the browser language without a remount', async () => {
    mount();
    expect(screen.getByRole('link', { name: /Runs/ })).toBeTruthy();
    setBrowserLanguages(['ru-RU']);
    act(() => {
      window.dispatchEvent(new Event('languagechange'));
    });
    expect(await screen.findByRole('link', { name: /Запуски/ })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ru');
  });
});

describe('language menu', () => {
  it('stores the chosen language', async () => {
    mount();
    openLanguageMenu();
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Русский' }));
    expect(window.localStorage.getItem('aip.web.language')).toBe('"ru"');
    expect(await screen.findByRole('link', { name: /Запуски/ })).toBeTruthy();
  });

  it('opens in the stored language after a reload', async () => {
    window.localStorage.setItem('aip.web.language', '"ru"');
    applyStoredLanguage();
    mount();
    expect(await screen.findByRole('link', { name: /Запуски/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Язык: Русский' })).toBeTruthy();
  });

  it('goes back to the browser language with «as in the browser»', async () => {
    setBrowserLanguages(['es-ES']);
    mount();
    openLanguageMenu();
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '中文' }));
    expect(await screen.findByRole('link', { name: /运行/ })).toBeTruthy();
    openLanguageMenu();
    fireEvent.click(await screen.findByRole('menuitemradio', { name: zh.language.system }));
    expect(await screen.findByRole('link', { name: /Ejecuciones/ })).toBeTruthy();
    expect(window.localStorage.getItem('aip.web.language')).toBe('"system"');
  });

  it('names every language in itself', async () => {
    mount();
    openLanguageMenu();
    for (const { name } of LANGUAGES) {
      expect(await screen.findByRole('menuitemradio', { name })).toBeTruthy();
    }
    expect(screen.getByRole('menuitemradio', { name: 'As in the browser' })).toBeTruthy();
  });

  it('switches the language from the command palette', async () => {
    mount();
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    fireEvent.keyDown(window, { key: 'k', metaKey: isMac, ctrlKey: !isMac });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'espa' } });
    fireEvent.click(await within(dialog).findByText('Español'));
    expect(await screen.findByRole('link', { name: /Ejecuciones/ })).toBeTruthy();
    expect(window.localStorage.getItem('aip.web.language')).toBe('"es"');
  });

  it('shows data as it is on any language', () => {
    mount([runView({ title: 'Флаг --json для aip version', state: 'needs_human', waiting: 1 })]);
    expect(screen.getAllByText('Флаг --json для aip version').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Needs answer (needs_human)').length).toBeGreaterThan(0);
  });
});

describe('term for a step in Russian', () => {
  const strings = (value: unknown, path = ''): [string, string][] =>
    typeof value === 'string'
      ? [[path, value]]
      : Object.entries(value as object).flatMap(([key, item]) =>
          strings(item, path ? `${path}.${key}` : key),
        );

  it('never says «шаг»: a step is an «этап»', () => {
    expect(strings(ru).filter(([, text]) => /шаг/i.test(text))).toEqual([]);
  });

  it('writes the run header button and the group menu with «этап»', () => {
    const t = i18next.getFixedT('ru');
    expect(t('runs.steps.button', { active: 3, total: 4 })).toBe('Этапы: 3 из 4');
    expect(t('runs.group.skipStep')).toBe('Пропустить этап');
  });
});

describe('formatting', () => {
  it('declines the number of files', () => {
    const t = i18next.getFixedT('ru');
    expect([1, 3, 5, 11, 21].map((count) => files(count, t))).toEqual([
      '1 файл',
      '3 файла',
      '5 файлов',
      '11 файлов',
      '21 файл',
    ]);
    const english = i18next.getFixedT('en');
    expect(files(1, english)).toBe('1 file');
    expect(files(3, english)).toBe('3 files');
    expect(files(3, i18next.getFixedT('zh'))).toBe('3 个文件');
  });

  it('formats a date by the rules of the language', () => {
    const now = new Date(2026, 10, 1, 12).getTime();
    const then = new Date(2026, 9, 31, 14, 32).getTime();
    const english = when(then, now, 'en');
    const russian = when(then, now, 'ru');
    expect(english).not.toBe(russian);
    expect(russian).toContain('31.10');
  });
});

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result.set(path, value);
    else for (const [inner, text] of flatten(value, path)) result.set(inner, text);
  }
  return result;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const reference = flatten(en);
const DICTIONARIES = { es, ru, zh } as Record<string, Tree>;

// Words that read the same in the language: names of languages, product and protocol terms.
const SAME_AS_ENGLISH = new Set([
  'B',
  'Pipeline',
  'OpenCode',
  'Tokens',
  'pipeline {{id}}',
  'Pipeline: {{id}}',
  'Pipeline: {{name}} ({{id}})',
  '{{action}} «{{id}}»?',
  '{{who}} {{n}}',
  'English',
  'Español',
  'Русский',
  '中文',
  // Spanish shares these words with English.
  'Error',
  'Global',
  'global',
  'General',
  // Units and abbreviations written the same way in several languages.
  'PID',
  's',
  'min',
  'h',
  'KB',
  'MB',
  'GB',
  '{{group}} · {{run}}',
  // The name of the agent.
  'Claude',
]);

describe.each(Object.keys(DICTIONARIES))('dictionary %s', (language) => {
  const dictionary = flatten(DICTIONARIES[language]!);

  it('has the placeholders of English in every text', () => {
    for (const [key, text] of dictionary) {
      const base = key.replace(PLURAL, '');
      const english = reference.get(key) ?? reference.get(`${base}_other`);
      expect(english, key).toBeDefined();
      const expected = placeholders(english!);
      // A plural form may leave out the number, as in «один файл»; other placeholders stay.
      const actual = placeholders(text);
      if (PLURAL.test(key)) {
        expect(
          actual.filter((name) => name !== 'count'),
          key,
        ).toEqual(expected.filter((name) => name !== 'count'));
      } else {
        expect(actual, key).toEqual(expected);
      }
    }
  });

  it('has every plural form the language needs', () => {
    const locale = LANGUAGES.find((entry) => entry.code === language)!.locale;
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const key of reference.keys()) {
      if (!key.endsWith('_other')) continue;
      const base = key.slice(0, -'_other'.length);
      for (const category of categories) {
        expect(dictionary.has(`${base}_${category}`), `${base}_${category}`).toBe(true);
      }
    }
  });

  it('translates every text', () => {
    const untranslated = [...dictionary].filter(
      ([key, text]) => reference.get(key) === text && !SAME_AS_ENGLISH.has(text),
    );
    expect(untranslated).toEqual([]);
  });
});

describe('the term «Pipeline»', () => {
  const values = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(values)
        : [];

  it.each([
    ['en', en],
    ['ru', ru],
    ['es', es],
    ['zh', zh],
  ])('does not call the pipeline a workflow in the %s dictionary', (_language, dictionary) => {
    // interpolation variables such as {{workflow}} are not texts
    const texts = values(dictionary).map((text) => text.replace(/\{\{[^}]*\}\}/g, ''));
    expect(texts.filter((text) => /workflow/i.test(text))).toEqual([]);
  });
});

describe('navigation in the strip', () => {
  it('names the language menu with the current language', async () => {
    window.localStorage.setItem('aip.web.language', '"ru"');
    window.localStorage.setItem('aip.web.navCollapsed', 'true');
    applyStoredLanguage();
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Язык: Русский' })).toBeTruthy());
  });
});
