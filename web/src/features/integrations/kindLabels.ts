import type { TFunction } from 'i18next';

/**
 * Human labels of the built-in integration kinds, their parameters and secrets. The panel
 * dictionary holds them; a kind, parameter or code it does not know shows its technical name.
 */

const base = (kind: string) => `integrations.kinds.${kind}`;

/** The title of a kind: the dictionary, else the title of the catalog, else the kind itself. */
export function kindTitle(t: TFunction, kind: string, catalogTitle?: string): string {
  return t(`${base(kind)}.title`, { defaultValue: catalogTitle ?? kind });
}

export function paramLabel(t: TFunction, kind: string, name: string): string {
  return t(`${base(kind)}.params.${name}.label`, { defaultValue: name });
}

/** The hint under a field; empty when the dictionary has none. */
export function paramHint(t: TFunction, kind: string, name: string): string {
  return t(`${base(kind)}.params.${name}.hint`, { defaultValue: '' });
}

export function valueLabel(t: TFunction, kind: string, name: string, value: string): string {
  return t(`${base(kind)}.params.${name}.values.${value}`, { defaultValue: value });
}

/** The text of the empty choice of an optional select; null when the dictionary has none. */
export function defaultValueLabel(t: TFunction, kind: string, name: string): string | null {
  const text = t(`${base(kind)}.params.${name}.default`, { defaultValue: '' });
  return text === '' ? null : text;
}

export function secretLabel(t: TFunction, kind: string, slot: string): string {
  return t(`${base(kind)}.secrets.${slot}.label`, { defaultValue: slot });
}

/** The text of a failed check code of a registry; the code itself when it is not known. */
export function checkCodeText(t: TFunction, code: string): string {
  return t(`integrations.check.codes.${code}`, { defaultValue: code });
}
