import type { en } from './locales/en.ts';

type Extra = 'zero' | 'two' | 'few' | 'many';
type PluralBase<K> = K extends `${infer Base}_other` ? Base : never;

/**
 * The shape of `en` with strings widened: a dictionary needs every key of the reference and no
 * other, except the CLDR plural forms (`_few`, `_many`, …) next to a plural key of the reference.
 */
type Widen<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
} & {
  [K in PluralBase<keyof T & string> as `${K}_${Extra}`]?: string;
};

export type Dictionary = Widen<typeof en>;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
