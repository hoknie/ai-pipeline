import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigCatalogResponse, EditorChain, FieldError } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Card } from '../../../shared/ui/layout/card.tsx';
import { fieldOf, type Draft, type FieldName } from './draft.ts';
import {
  FieldInput,
  fieldLabel,
  hintOf,
  inheritedToolsOf,
  type InputProps,
} from './fieldInputs.tsx';

export {
  FIELDS,
  draftOf,
  fieldOf,
  sameDraft,
  valueOf,
  type Draft,
  type FieldName,
  type ListField,
} from './draft.ts';

/** The fields of the form by section; the titles are `specialists.sections.<key>`. */
const SECTIONS: { key: 'main' | 'limits' | 'tools' | 'prompt'; fields: FieldName[] }[] = [
  {
    key: 'main',
    fields: ['name', 'runtime_chain', 'runtime', 'model', 'variant', 'reasoning_effort', 'tags'],
  },
  { key: 'limits', fields: ['permissions', 'timeout', 'max', 'allow_commands'] },
  { key: 'tools', fields: ['tools', 'skills'] },
  { key: 'prompt', fields: ['prompt'] },
];

/** A field with its label, help, hints and errors. */
function FieldBlock({
  input,
  errors,
  tagsHelp,
}: {
  input: InputProps;
  errors: FieldError[];
  tagsHelp: string | undefined;
}) {
  const { t } = useTranslation();
  const { field, draft, defaults } = input;
  const hint = hintOf(field, defaults, t);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`field-${field}`}>{fieldLabel(field, t)}</Label>
      <FieldInput {...input} />
      <p className="text-xs text-muted-foreground">
        {field === 'tags' && tagsHelp !== undefined ? tagsHelp : t(`specialists.help.${field}`)}
      </p>
      {field === 'runtime_chain' && draft.runtime_chain ? (
        <p className="text-xs text-muted-foreground">{t('specialists.chainActiveHint')}</p>
      ) : null}
      {field === 'reasoning_effort' &&
      draft.variant.trim() !== '' &&
      draft.reasoning_effort !== '' ? (
        <p className="text-xs text-muted-foreground">{t('specialists.variantOverridesEffort')}</p>
      ) : null}
      {field === 'allow_commands' && draft.allow_commands.length === 0 && hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {field === 'tools' && draft.tools.length > 0 && inheritedToolsOf(defaults).length > 0 ? (
        <p className="text-xs text-muted-foreground">{t('specialists.replacesDefaults')}</p>
      ) : null}
      {errors.map((error) => (
        <p className="text-sm text-destructive" role="alert" key={error.message}>
          {error.message}
        </p>
      ))}
    </div>
  );
}

interface SpecialistFieldsProps {
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
  chains?: EditorChain[];
  /** Fields that are not shown. */
  omit?: FieldName[];
  /** The control of the field `tags`; the field is not shown without it. */
  tags?: ReactNode;
  /** The help under the field `tags`. */
  tagsHelp?: string;
  /** Goes first in the section «main»: the slug of a new specialist. */
  mainStart?: ReactNode;
}

/**
 * The fields of a specialist as sections of cards: the form of a specialist and the tab of the
 * observer's specialist both draw them. What differs comes in as props.
 */
export function SpecialistFields(props: SpecialistFieldsProps) {
  const { draft, onDraft, disabled, errors, prefix, defaults, catalog, catalogError, chains } =
    props;
  const { omit = [], tags, tagsHelp, mainStart } = props;
  const { t } = useTranslation();
  const errorsOf = (field: FieldName) =>
    errors.filter((error) => fieldOf(error.path, prefix) === field);
  const hasChain = draft.runtime_chain.trim() !== '';
  const showOpencode =
    !hasChain &&
    ((draft.runtime || defaults['defaults.runtime'] || 'claude') === 'opencode' ||
      draft.variant.trim() !== '' ||
      draft.reasoning_effort.trim() !== '');
  const shown = (field: FieldName) => {
    if (omit.includes(field)) return false;
    if (field === 'tags' && tags === undefined) return false;
    if (
      hasChain &&
      (field === 'runtime' ||
        field === 'model' ||
        field === 'variant' ||
        field === 'reasoning_effort')
    ) {
      return false;
    }
    return showOpencode || (field !== 'variant' && field !== 'reasoning_effort');
  };
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
                {fields.map((field) => (
                  <FieldBlock
                    key={field}
                    input={{
                      field,
                      draft,
                      onDraft,
                      disabled,
                      invalid: errorsOf(field).length > 0,
                      defaults,
                      catalog,
                      tags,
                      chains,
                    }}
                    errors={errorsOf(field)}
                    tagsHelp={tagsHelp}
                  />
                ))}
              </section>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
