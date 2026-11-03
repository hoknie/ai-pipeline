import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { Alert } from '../ui/alert.tsx';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { Card } from '../ui/card.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';

import { ValuesPicker } from './ValuesPicker.tsx';
import type {
  CatalogEntry,
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
  EntryReference,
  FieldError,
  WriteLevel,
} from '../types.ts';

const RUNTIMES = ['claude', 'opencode'];
const PERMISSIONS = ['read', 'edit', 'full'];
/** Radix `Select` has no empty value: this one stands for «take it from defaults». */
const INHERIT = '__inherit';

type FieldName =
  | 'name'
  | 'model'
  | 'runtime'
  | 'permissions'
  | 'timeout'
  | 'allow_commands'
  | 'tools'
  | 'skills'
  | 'max'
  | 'prompt';

const FIELDS: FieldName[] = [
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
];
type ListField = 'allow_commands' | 'tools' | 'skills';
const LIST_FIELDS = new Set<FieldName>(['allow_commands', 'tools', 'skills']);

const isList = (field: FieldName): field is ListField => LIST_FIELDS.has(field);

/** The fields of the form by section; the titles are `specialists.sections.<key>`. */
const SECTIONS: { key: 'main' | 'limits' | 'tools' | 'prompt'; fields: FieldName[] }[] = [
  { key: 'main', fields: ['name', 'runtime', 'model'] },
  { key: 'limits', fields: ['permissions', 'timeout', 'max', 'allow_commands'] },
  { key: 'tools', fields: ['tools', 'skills'] },
  { key: 'prompt', fields: ['prompt'] },
];
function fieldLabel(field: FieldName, t: TFunction): string {
  return t(`specialists.fields.${field}`);
}

type Draft = Record<Exclude<FieldName, ListField>, string> & Record<ListField, string[]>;

function draftOf(raw: Record<string, unknown>): Draft {
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

function sameDraft(a: Draft, b: Draft): boolean {
  return FIELDS.every((field) => {
    const left = a[field];
    const right = b[field];
    return Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((item, index) => item === right[index])
      : left === right;
  });
}

function fieldOf(path: string, slug: string): FieldName | null {
  const prefix = `swarm.specialists.${slug}.`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).split(/[.[]/)[0] as FieldName;
  return FIELDS.includes(name) ? name : null;
}

function describeReference(reference: EntryReference): string {
  if (reference.field) return reference.field;
  if (reference.split) return `${reference.workflow} → split`;
  return `${reference.workflow} → ${reference.step}`;
}

export function SpecialistForm({
  api,
  view,
  specialist,
  catalog,
  catalogError,
  notice,
  onDirty,
  onReload,
  onSaved,
  onDeleted,
}: {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new specialist. */
  specialist: EditorSpecialist | null;
  /** Tools and skills to choose from; null while it is not loaded or failed to load. */
  catalog: ConfigCatalogResponse | null;
  catalogError: string | null;
  notice: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (slug: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [level, setLevel] = useState<WriteLevel>(
    specialist?.level === 'global' ? 'global' : 'project',
  );
  const sources = specialist?.sources ?? {};
  const source = sources[level];
  const bothLevels = Boolean(sources.project && sources.global);
  // A level without a file starts from the file that applies.
  const raw = source?.raw ?? specialist?.raw ?? {};
  const revision = source?.revision ?? null;
  const initial = useMemo(() => draftOf(raw), [raw]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [slug, setSlug] = useState(specialist?.slug ?? '');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [references, setReferences] = useState<EntryReference[]>([]);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const readOnly = false;
  const dirty = !sameDraft(draft, initial) || (!specialist && slug !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const defaults = Object.fromEntries(
    view.settings
      .filter((setting) => setting.path.startsWith('defaults.'))
      .map((s) => [s.path, s.value]),
  );
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

  const id = specialist?.slug ?? slug;
  const fieldErrors = (field: FieldName) =>
    errors.filter((error) => fieldOf(error.path, id) === field);
  const otherErrors = errors.filter((error) => fieldOf(error.path, id) === null);

  const report = (result: Awaited<ReturnType<Api['writeSpecialist']>>): boolean => {
    if (result.ok) return true;
    if (result.reason === 'conflict') setConflict(result.message);
    else {
      setErrors(result.errors);
      setReferences(result.references ?? []);
    }
    return false;
  };

  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    attempt(async () => {
      setErrors([]);
      setConflict(null);
      const target = specialist ? specialist.slug : slug;
      const result = await api.writeSpecialist(
        target,
        valueOf(draft, raw),
        specialist ? revision : null,
        level,
      );
      if (report(result)) await onSaved(target);
    });

  const saveCopy = () =>
    attempt(async () => {
      setErrors([]);
      setConflict(null);
      const target = saveAs ?? '';
      const result = await api.writeSpecialist(target, valueOf(draft, raw), null, level);
      if (report(result)) await onSaved(target);
    });

  /** Copies the file that applies to the other level, which has none. */
  const copyTo = (target: WriteLevel) =>
    attempt(async () => {
      const result = await api.writeSpecialist(
        specialist?.slug ?? '',
        specialist?.raw ?? {},
        null,
        target,
      );
      if (report(result)) await onSaved(specialist?.slug ?? '');
    });

  const switchLevel = async (next: WriteLevel) => {
    if (next === level) return;
    if (
      dirty &&
      !(await confirm({
        title: t('settings.editor.switchTitle'),
        description: t('settings.editor.lostValues'),
        confirmLabel: t('settings.editor.switch'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    setErrors([]);
    setConflict(null);
    setReferences([]);
    setDraft(draftOf(specialist?.sources[next]?.raw ?? specialist?.raw ?? {}));
    setLevel(next);
  };

  const remove = () =>
    attempt(async () => {
      if (!specialist || !source) return;
      const label = removeLabel;
      const yes = await confirm({
        title: t('settings.editor.removeTitle', { action: label, id: specialist.slug }),
        description: t('settings.editor.removeDescription', { file: source.file }),
        confirmLabel: label,
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      setReferences([]);
      const result = await api.deleteSpecialist(specialist.slug, source.revision, level);
      if (report(result)) await onDeleted();
    });

  const removeLabel =
    level === 'project' && sources.global
      ? t('settings.editor.removeOverride')
      : t('settings.editor.remove');

  const reread = async () => {
    if (
      dirty &&
      !(await confirm({
        title: t('specialists.rereadTitle'),
        description: t('settings.editor.lostValues'),
        confirmLabel: t('settings.editor.reread'),
        destructive: true,
      }))
    )
      return;
    onDirty(false);
    await onReload();
  };

  const set = (field: FieldName, text: string) =>
    setDraft((current) => ({ ...current, [field]: text }));
  const setList = (field: ListField, items: string[]) =>
    setDraft((current) => ({ ...current, [field]: items }));

  const input = (field: FieldName) => {
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
          disabled={readOnly || busy}
          invalid={fieldErrors(field).length > 0}
        />
      );
    }
    const common = {
      id: `field-${field}`,
      value: draft[field],
      disabled: readOnly || busy,
      'aria-invalid': fieldErrors(field).length > 0,
      onChange: (event: { target: { value: string } }) => set(field, event.target.value),
    };
    if (field === 'runtime' || field === 'permissions') {
      return (
        <Select
          value={draft[field] === '' ? INHERIT : draft[field]}
          disabled={readOnly || busy}
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

  const levelToggle =
    (specialist && bothLevels) || !specialist ? (
      <ToggleGroup
        type="single"
        value={level}
        aria-label={t('settings.editor.level')}
        onValueChange={(value) =>
          value &&
          (specialist ? void switchLevel(value as WriteLevel) : setLevel(value as WriteLevel))
        }
      >
        <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
        <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
      </ToggleGroup>
    ) : null;

  const renderField = (field: FieldName) => (
    <div className="flex flex-col gap-1.5" key={field}>
      <Label htmlFor={`field-${field}`}>{fieldLabel(field, t)}</Label>
      {input(field)}
      <p className="text-xs text-muted-foreground">{t(`specialists.help.${field}`)}</p>
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
    <section
      className="flex flex-col gap-3"
      aria-label={t('specialists.section', { id: id || t('specialists.newName') })}
    >
      <header
        role="toolbar"
        aria-label={t('specialists.header')}
        data-sticky
        // -top-4/-mt-4/-mx-4 cancel the p-4 of <main> in SplitPage, so no strip of scrolled content shows above the header
        className="sticky -top-4 z-10 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-background px-4 py-2"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">
            {specialist ? specialist.slug : t('specialists.new')}
          </h2>
          <Badge variant="outline">
            {t(`settings.editor.levels.${specialist ? specialist.level : level}`)}
          </Badge>
          {specialist ? (
            <code
              title={source?.file ?? specialist.file}
              className="block min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
            >
              {source?.file ?? specialist.file}
            </code>
          ) : null}
        </div>
        {levelToggle ? <div className="flex">{levelToggle}</div> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || (!specialist && !slug)} onClick={() => void save()}>
            {t('settings.editor.save')}
          </Button>
          {specialist && sources.global && !sources.project ? (
            <Button variant="outline" disabled={busy} onClick={() => void copyTo('project')}>
              {t('settings.editor.overrideInProject')}
            </Button>
          ) : null}
          {specialist && sources.project && !sources.global ? (
            <Button variant="outline" disabled={busy} onClick={() => void copyTo('global')}>
              {t('settings.editor.makeGlobal')}
            </Button>
          ) : null}
          {specialist ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSaveAs(saveAs === null ? '' : null)}
            >
              {t('settings.editor.saveAs')}
            </Button>
          ) : null}
          {specialist && source ? (
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {removeLabel}
            </Button>
          ) : null}
        </div>
      </header>
      {saveAs !== null ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-save-as">{t('specialists.newSlug')}</Label>
          <div className="flex gap-2">
            <Input
              id="field-save-as"
              type="text"
              value={saveAs}
              onChange={(event) => setSaveAs(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || saveAs === ''}
              onClick={() => void saveCopy()}
            >
              {t('settings.editor.createCopy')}
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? <Alert role="status">{notice}</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-2">
          <p>{t('settings.editor.conflict', { message: conflict })}</p>
          <Button variant="outline" size="sm" onClick={() => void reread()}>
            {t('specialists.reread')}
          </Button>
        </Alert>
      ) : null}
      {otherErrors.length > 0 ? (
        <Alert variant="destructive">
          <ul>
            {otherErrors.map((error) => (
              <li key={`${error.path}:${error.message}`}>
                <code>{error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {references.length > 0 ? (
        <Alert variant="destructive">
          <p>{t('specialists.usedBy')}</p>
          <ul className="list-disc pl-4">
            {references.map((reference) => (
              <li key={describeReference(reference)}>{describeReference(reference)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {level === 'global' ? (
        <p className="text-sm text-muted-foreground">
          {t('settings.editor.globalHint')}
          {sources.project ? t('settings.editor.globalOverridden') : ''}
        </p>
      ) : sources.global ? (
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="settings.editor.projectOverrides"
            values={{ file: sources.global.file }}
            components={{ code: <code /> }}
          />
        </p>
      ) : null}
      {SECTIONS.map((section) => (
        <Card key={section.key}>
          <section aria-labelledby={`section-${section.key}`} className="flex flex-col gap-3 p-4">
            <h3 id={`section-${section.key}`} className="text-sm font-semibold">
              {t(`specialists.sections.${section.key}`)}
            </h3>
            {section.key === 'main' && !specialist ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="field-slug">Slug</Label>
                <Input
                  id="field-slug"
                  type="text"
                  value={slug}
                  disabled={busy}
                  placeholder="coder"
                  onChange={(event) => setSlug(event.target.value)}
                />
              </div>
            ) : null}
            {section.key === 'tools' && catalogError ? (
              <Alert variant="destructive">
                {t('specialists.catalogError', { message: catalogError })}
              </Alert>
            ) : null}
            {section.fields.map(renderField)}
          </section>
        </Card>
      ))}
    </section>
  );
}
