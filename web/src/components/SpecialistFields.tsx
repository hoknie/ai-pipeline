import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert } from '../ui/alert.tsx';
import { Card } from '../ui/card.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import { Textarea } from '../ui/textarea.tsx';
import type { CatalogEntry, ConfigCatalogResponse, FieldError } from '../types.ts';
import { ValuesPicker } from './ValuesPicker.tsx';

const RUNTIMES = ['claude', 'opencode'];
const PERMISSIONS = ['read', 'edit', 'full'];
/** Radix `Select` has no empty value: this one stands for «take it from defaults». */
const INHERIT = '__inherit';

export type FieldName =
  | 'name'
  | 'model'
  | 'runtime'
  | 'permissions'
  | 'timeout'
  | 'allow_commands'
  | 'tools'
  | 'skills'
  | 'max'
  | 'prompt'
  | 'tags';

export const FIELDS: FieldName[] = [
  'name',
  'runtime',
  'model',
  'permissions',
  'timeout',
  'allow_commands',
  'tools',
  'skills',
  'max',
  'prompt',
  'tags',
];
export type ListField = 'allow_commands' | 'tools' | 'skills' | 'tags';
const LIST_FIELDS = new Set<FieldName>(['allow_commands', 'tools', 'skills', 'tags']);

const isList = (field: FieldName): field is ListField => LIST_FIELDS.has(field);

/** The fields of the form by section; the titles are `specialists.sections.<key>`. */
const SECTIONS: { key: 'main' | 'limits' | 'tools' | 'prompt'; fields: FieldName[] }[] = [
  { key: 'main', fields: ['name', 'runtime', 'model', 'tags'] },
  { key: 'limits', fields: ['permissions', 'timeout', 'max', 'allow_commands'] },
  { key: 'tools', fields: ['tools', 'skills'] },
  { key: 'prompt', fields: ['prompt'] },
];

function fieldLabel(field: FieldName, t: TFunction): string {
  return t(`specialists.fields.${field}`);
}

export type Draft = Record<Exclude<FieldName, ListField>, string> & Record<ListField, string[]>;

export function draftOf(raw: Record<string, unknown>): Draft {
  const draft: Record<string, string | string[]> = {};
  for (const field of FIELDS) {
    const value = raw[field];
    if (isList(field)) {
      draft[field] = Array.isArray(value)
        ? value.map(String)
        : value === undefined || value === null || value === ''
          ? []
          : [String(value)];
    } else {
      draft[field] = value === undefined || value === null ? '' : String(value);
    }
  }
  return draft as Draft;
}

/** The file content for a draft: empty fields are left out, keys the form does not know stay. */
export function valueOf(draft: Draft, raw: Record<string, unknown>): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (isList(field)) {
      const items = draft[field].map((item) => item.trim()).filter((item) => item !== '');
      if (items.length > 0) filled[field] = items;
      continue;
    }
    const text = draft[field];
    if (field === 'prompt') {
      if (text.trim() !== '') filled[field] = text;
    } else if (text.trim() !== '') {
      filled[field] =
        field === 'max' && /^\d+$/.test(text.trim()) ? Number(text.trim()) : text.trim();
    }
  }
  // keys of the file keep their place; new ones follow in form order
  const value: Record<string, unknown> = {};
  for (const [key, original] of Object.entries(raw)) {
    if (!(FIELDS as string[]).includes(key)) value[key] = original;
    else if (key in filled) value[key] = filled[key];
  }
  for (const field of FIELDS)
    if (field in filled && !(field in value)) value[field] = filled[field];
  return value;
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return FIELDS.every((field) => {
    const left = a[field];
    const right = b[field];
    return Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((item, index) => item === right[index])
      : left === right;
  });
}

/** The field a validation error is about; `prefix` is the path before the field, with its dot. */
export function fieldOf(path: string, prefix: string): FieldName | null {
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).split(/[.[]/)[0] as FieldName;
  return FIELDS.includes(name) ? name : null;
}

/**
 * The fields of a specialist as sections of cards: the form of a specialist and the tab of the
 * observer's specialist both draw them. What differs comes in as props.
 */
export function SpecialistFields({
  draft,
  onDraft,
  disabled,
  errors,
  prefix,
  defaults,
  catalog,
  catalogError,
  omit = [],
  tags,
  tagsHelp,
  mainStart,
}: {
  draft: Draft;
  onDraft: (update: (current: Draft) => Draft) => void;
  disabled: boolean;
  /** The errors of the form; those of the shown fields are drawn under them. */
  errors: FieldError[];
  /** The path before a field in an error, such as `swarm.specialists.coder.`. */
  prefix: string;
  /** The values `defaults.*` the empty fields fall back to, by path. */
  defaults: Record<string, unknown>;
  /** Tools and skills to choose from; null while it is not loaded or failed to load. */
  catalog: ConfigCatalogResponse | null;
  catalogError: string | null;
  /** Fields that are not shown. */
  omit?: FieldName[];
  /** The control of the field `tags`; the field is not shown without it. */
  tags?: ReactNode;
  /** The help under the field `tags`. */
  tagsHelp?: string;
  /** Goes first in the section «main»: the slug of a new specialist. */
  mainStart?: ReactNode;
}) {
  const { t } = useTranslation();
  const fieldErrors = (field: FieldName) =>
    errors.filter((error) => fieldOf(error.path, prefix) === field);

  const hint = (field: FieldName): string => {
    if (field === 'runtime' || field === 'permissions' || field === 'timeout') {
      return t('specialists.fromDefaults', { value: String(defaults[`defaults.${field}`] ?? '') });
    }
    if (field === 'allow_commands') {
      const inherited = defaults[`defaults.${field}`];
      return Array.isArray(inherited) && inherited.length > 0
        ? t('specialists.fromDefaults', { value: inherited.join(', ') })
        : '';
    }
    return '';
  };

  const inheritedTools = (() => {
    const inherited = defaults['defaults.tools'];
    return Array.isArray(inherited) ? inherited.map(String) : [];
  })();
  const runtime = draft.runtime || String(defaults['defaults.runtime'] ?? 'claude');
  const catalogOf = (field: 'tools' | 'skills'): CatalogEntry[] | null => {
    const entry = catalog?.runtimes[runtime === 'opencode' ? 'opencode' : 'claude'];
    return entry ? entry[field] : null;
  };
  const markOf = (field: 'tools' | 'skills') => {
    const known = catalogOf(field);
    return (value: string): string | null => {
      if (!known) return null;
      if (!known.some((entry) => entry.name === value)) return t('picker.notFound');
      return field === 'tools' &&
        runtime !== 'opencode' &&
        value.startsWith('mcp__') &&
        !catalog?.mcpInherited
        ? t('picker.mcpIsolated')
        : null;
    };
  };

  const set = (field: FieldName, text: string) =>
    onDraft((current) => ({ ...current, [field]: text }));
  const setList = (field: ListField, items: string[]) =>
    onDraft((current) => ({ ...current, [field]: items }));

  const input = (field: FieldName) => {
    if (field === 'tags') return tags;
    if (isList(field)) {
      return (
        <ValuesPicker
          id={`field-${field}`}
          label={fieldLabel(field, t)}
          values={draft[field]}
          onChange={(items) => setList(field, items)}
          options={field === 'allow_commands' ? [] : (catalogOf(field) ?? [])}
          inherited={field === 'tools' && draft.tools.length === 0 ? inheritedTools : []}
          mark={field === 'allow_commands' ? undefined : markOf(field)}
          disabled={disabled}
          invalid={fieldErrors(field).length > 0}
        />
      );
    }
    const common = {
      id: `field-${field}`,
      value: draft[field],
      disabled,
      'aria-invalid': fieldErrors(field).length > 0,
      onChange: (event: { target: { value: string } }) => set(field, event.target.value),
    };
    if (field === 'runtime' || field === 'permissions') {
      return (
        <Select
          value={draft[field] === '' ? INHERIT : draft[field]}
          disabled={disabled}
          onValueChange={(value) => set(field, value === INHERIT ? '' : value)}
        >
          <SelectTrigger id={`field-${field}`} aria-invalid={fieldErrors(field).length > 0}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>{hint(field) || t('specialists.byDefault')}</SelectItem>
            {(field === 'runtime' ? RUNTIMES : PERMISSIONS).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (field === 'prompt') {
      return (
        <Textarea
          {...common}
          rows={10}
          placeholder={hint(field)}
          spellCheck={false}
          className="font-mono text-xs"
        />
      );
    }
    return <Input type="text" {...common} placeholder={hint(field)} />;
  };

  const shown = (field: FieldName) =>
    !omit.includes(field) && (field !== 'tags' || tags !== undefined);

  const renderField = (field: FieldName) => (
    <div className="flex flex-col gap-1.5" key={field}>
      <Label htmlFor={`field-${field}`}>{fieldLabel(field, t)}</Label>
      {input(field)}
      <p className="text-xs text-muted-foreground">
        {field === 'tags' && tagsHelp !== undefined ? tagsHelp : t(`specialists.help.${field}`)}
      </p>
      {field === 'allow_commands' && draft.allow_commands.length === 0 && hint(field) ? (
        <p className="text-xs text-muted-foreground">{hint(field)}</p>
      ) : null}
      {field === 'tools' && draft.tools.length > 0 && inheritedTools.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t('specialists.replacesDefaults')}</p>
      ) : null}
      {fieldErrors(field).map((error) => (
        <p className="text-sm text-destructive" role="alert" key={error.message}>
          {error.message}
        </p>
      ))}
    </div>
  );

  return (
    <div className="@container">
      <div className="grid gap-3 @3xl:grid-cols-2">
        {SECTIONS.map((section) => {
          const fields = section.fields.filter(shown);
          if (fields.length === 0) return null;
          return (
            <Card key={section.key}>
              <section
                aria-labelledby={`section-${section.key}`}
                className="flex flex-col gap-3 p-4"
              >
                <h3 id={`section-${section.key}`} className="text-sm font-semibold">
                  {t(`specialists.sections.${section.key}`)}
                </h3>
                {section.key === 'main' ? mainStart : null}
                {section.key === 'tools' && catalogError ? (
                  <Alert variant="destructive">
                    {t('specialists.catalogError', { message: catalogError })}
                  </Alert>
                ) : null}
                {fields.map(renderField)}
              </section>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
