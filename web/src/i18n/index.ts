import i18next from 'i18next';
import { useEffect, useSyncExternalStore } from 'react';
import { initReactI18next, useTranslation } from 'react-i18next';

import { en } from './locales/en.ts';
import { es } from './locales/es.ts';
import { ru } from './locales/ru.ts';
import { zh } from './locales/zh.ts';
import './types.ts';

/** Languages of the panel; the only place with their names, written in the language itself. */
export const LANGUAGES = [
  { code: 'en', name: 'English', locale: 'en' },
  { code: 'es', name: 'Español', locale: 'es' },
  { code: 'ru', name: 'Русский', locale: 'ru' },
  { code: 'zh', name: '中文', locale: 'zh-CN' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];
export type LanguageChoice = 'system' | Language;

const CODES: readonly string[] = LANGUAGES.map((language) => language.code);
const KEY = 'aip.web.language';

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && CODES.includes(value);
}

/** Tag of the language for `lang` and for dates: `zh` is shown as simplified Chinese. */
export function localeTag(language: Language): string {
  return LANGUAGES.find((entry) => entry.code === language)?.locale ?? 'en';
}

/** The first browser language whose primary subtag the panel supports, otherwise English. */
export function detectLanguage(languages: readonly string[]): Language {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return 'en';
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    ru: { translation: ru },
    zh: { translation: zh },
  },
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  returnNull: false,
  interpolation: { escapeValue: false },
});

// Without a usable localStorage the choice lives for the page only.
let memory: LanguageChoice = 'system';
const listeners = new Set<() => void>();

function readChoice(): LanguageChoice {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return 'system';
    const value = JSON.parse(raw) as unknown;
    return isLanguage(value) ? value : 'system';
  } catch {
    return memory;
  }
}

function browserLanguages(): readonly string[] {
  const { languages, language } = window.navigator;
  return languages && languages.length > 0 ? languages : language ? [language] : [];
}

function apply(choice: LanguageChoice): Language {
  const language = choice === 'system' ? detectLanguage(browserLanguages()) : choice;
  if (i18next.language !== language) void i18next.changeLanguage(language);
  document.documentElement.lang = localeTag(language);
  return language;
}

/** Puts the saved language on the page; called before the first render so nothing flashes. */
export function applyStoredLanguage(): void {
  apply(readChoice());
}

function setChoice(choice: LanguageChoice): void {
  memory = choice;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    // Private mode or a full quota: the choice still holds for this page.
  }
  apply(choice);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen language (or «as in the browser») shared by the menu and the palette. */
export function useLanguage(): {
  choice: LanguageChoice;
  language: Language;
  setChoice: (choice: LanguageChoice) => void;
} {
  const choice = useSyncExternalStore(subscribe, readChoice, readChoice);
  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const follow = () => {
      apply('system');
      for (const listener of listeners) listener();
    };
    window.addEventListener('languagechange', follow);
    return () => window.removeEventListener('languagechange', follow);
  }, [choice]);
  const language = choice === 'system' ? detectLanguage(browserLanguages()) : choice;
  return { choice, language, setChoice };
}

/** Locale tag of the active language, for dates and times. */
export function useLocale(): string {
  const { i18n } = useTranslation();
  return localeTag(isLanguage(i18n.language) ? i18n.language : 'en');
}
