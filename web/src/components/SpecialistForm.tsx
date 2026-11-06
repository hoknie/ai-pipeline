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

import { sameTag } from '../specialistTags.ts';
import { repositoryLabel } from '../repositories.ts';
import { FILE_PATH_CLASS, FilePath } from './FilePath.tsx';
import { SpecialistTagChip } from './SpecialistTagChip.tsx';
import { ValuesPicker } from './ValuesPicker.tsx';
import {
  SpecialistFields,
  draftOf,
  fieldOf,
  type FieldName,
  sameDraft,
  valueOf,
  type Draft,
} from './SpecialistFields.tsx';
import { rawName } from './pipelineName.ts';
import type {
  CatalogEntry,
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
  EntryReference,
  FieldError,
  SharedSpecialistView,
  WriteLevel,
} from '../types.ts';

export { valueOf };

export function describeReference(
  reference: EntryReference,
  view: ConfigEditorResponse | null,
): string {
  const where = (() => {
    if (reference.field) return reference.field;
    const entry = reference.repository
      ? undefined
      : view?.pipelines.find((candidate) => candidate.id === reference.pipeline);
    const pipeline = (entry ? rawName(entry.raw) : null) ?? reference.pipeline;
    if (reference.split) return `${pipeline} → split`;
    return `${pipeline} → ${reference.step}`;
  })();
  return reference.repository ? `${repositoryLabel(reference.repository)}: ${where}` : where;
}

/** The shared-level view of the form: the usage of the specialist by the projects. */
export interface SharedOnly {
  /** Usage of the open specialist; null while it is not loaded. */
  usage: SharedSpecialistView | null;
  usageError: string | null;
  /** Reads the usage again, for example after the daemon refused a delete. */
  onUsageStale: () => void;
}

function UsageBlock({ shared, view }: { shared: SharedOnly; view: ConfigEditorResponse }) {
  const { t } = useTranslation();
  const { usage, usageError } = shared;
  return (
    <Card>
      <section aria-labelledby="usage-title" className="flex flex-col gap-2 p-4">
        <h3 id="usage-title" className="text-sm font-semibold">
          {t('sharedSpecialists.usage.title')}
        </h3>
        {usageError ? (
          <Alert variant="destructive">
            {t('sharedSpecialists.usage.error', { message: usageError })}
          </Alert>
        ) : usage === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('sharedSpecialists.usage.loading')}
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="usage-count">
              {t('sharedSpecialists.usage.count', { count: usage.projects.length })}
            </p>
            {usage.projects.length === 0 && usage.global.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('sharedSpecialists.usage.none')}</p>
            ) : null}
            <ul aria-label={t('sharedSpecialists.usage.title')} className="flex flex-col gap-1">
              {usage.global.length > 0 ? (
                <li className="text-sm">
                  <span className="font-medium">{t('sharedSpecialists.usage.shared')}</span>:{' '}
                  {usage.global.map((reference) => describeReference(reference, view)).join(', ')}
                </li>
              ) : null}
              {usage.projects.map((project) => (
                <li key={project.repository} className="text-sm">
                  <span className="font-medium" title={project.repository}>
                    {repositoryLabel(project.repository)}
                  </span>
                  :{' '}
                  {project.references
                    .map((reference) => describeReference(reference, null))
                    .join(', ')}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Card>
  );
}

/**
 * The value written to a file of the level. The tags of a shared file are changed only in the file:
 * a shared file keeps its tags as they are and a new shared file has none.
 */
function forLevel(
  value: Record<string, unknown>,
  level: WriteLevel,
  stored: Record<string, unknown> | null,
): Record<string, unknown> {
  if (level !== 'global') return value;
  const { tags: _tags, ...rest } = value;
  return stored !== null && stored.tags !== undefined ? { ...rest, tags: stored.tags } : rest;
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
  sharedOnly,
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
  /** Edits a shared specialist at the shared level only, with the usage by the projects. */
  sharedOnly?: SharedOnly;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [level, setLevel] = useState<WriteLevel>(
    sharedOnly || specialist?.level === 'global' ? 'global' : 'project',
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

  // a shared (global) specialist is view only; the project override is how to change it
  const readOnly = Boolean(specialist) && level === 'global' && !sharedOnly;
  const dirty = !sameDraft(draft, initial) || (!specialist && slug !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  // the shared level is checked against the shared defaults, not against what a project makes of them
  const defaults = Object.fromEntries(
    view.settings
      .filter((setting) => setting.path.startsWith('defaults.'))
      .map((s) => [s.path, sharedOnly ? s.globalValue : s.value]),
  );
  const id = specialist?.slug ?? slug;
  const prefix = `swarm.specialists.${id}.`;
  const fieldErrors = (field: FieldName) =>
    errors.filter((error) => fieldOf(error.path, prefix) === field);
  const otherErrors = errors.filter((error) => fieldOf(error.path, prefix) === null);

  const report = (result: Awaited<ReturnType<Api['writeSpecialist']>>): boolean => {
    if (result.ok) return true;
    if (result.reason === 'conflict') setConflict(result.message);
    else {
      setErrors(result.errors);
      setReferences(result.references ?? []);
      if (sharedOnly && (result.references ?? []).length > 0) sharedOnly.onUsageStale();
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
        forLevel(valueOf(draft, raw), level, specialist && source ? raw : null),
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
      const result = await api.writeSpecialist(
        target,
        forLevel(valueOf(draft, raw), level, null),
        null,
        level,
      );
      if (report(result)) await onSaved(target);
    });

  /** Copies the file that applies to the other level, which has none. */
  const copyTo = (target: WriteLevel) =>
    attempt(async () => {
      // the copy has no tags: the tags of the source level stay there
      const { tags: _tags, ...copy } = specialist?.raw ?? {};
      const result = await api.writeSpecialist(specialist?.slug ?? '', copy, null, target);
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

  const removeBlocked =
    sharedOnly !== undefined &&
    (sharedOnly.usage === null ||
      sharedOnly.usage.projects.length > 0 ||
      sharedOnly.usage.global.length > 0);
  const removeBlockedReason =
    sharedOnly?.usage === null
      ? t('sharedSpecialists.usage.waiting')
      : t('sharedSpecialists.usage.blocked');

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

  const tagsInput = () => {
    // on the shared level the tags are the shared ones: view only
    const shared = level === 'global' ? draft.tags : (specialist?.shared_tags ?? []);
    const suggestions = new Map<string, string>();
    for (const entry of view.specialists) {
      for (const name of entry.own_tags) suggestions.set(name.toLocaleLowerCase(), name);
    }
    return (
      <div className="flex flex-col gap-1.5" data-testid="specialist-tags">
        {shared.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <ul aria-label={t('specialists.tags.sharedList')} className="flex flex-wrap gap-1.5">
              {shared.map((name) => (
                <li key={name}>
                  <SpecialistTagChip name={name} shared />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {level === 'global' ? null : (
          <ValuesPicker
            id="field-tags"
            label={t('specialists.fields.tags')}
            values={draft.tags}
            onChange={(items) => setDraft((current) => ({ ...current, tags: items }))}
            options={[...suggestions.values()]
              .filter((name) => !shared.some((known) => sameTag(known, name)))
              .map((name) => ({ name, source: 'project' as const }))}
            headings={{ project: t('specialists.tags.own') }}
            disabled={readOnly || busy}
            invalid={fieldErrors('tags').length > 0}
          />
        )}
      </div>
    );
  };

  const levelToggle =
    !sharedOnly && ((specialist && bothLevels) || !specialist) ? (
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
        </div>
        {specialist ? <FilePath variant="line" path={source?.file ?? specialist.file} /> : null}
        {levelToggle ? <div className="flex">{levelToggle}</div> : null}
        <div className="flex flex-wrap gap-2">
          {readOnly ? null : (
            <Button disabled={busy || (!specialist && !slug)} onClick={() => void save()}>
              {t('settings.editor.save')}
            </Button>
          )}
          {specialist && !sharedOnly && sources.global && !sources.project ? (
            <Button variant="outline" disabled={busy} onClick={() => void copyTo('project')}>
              {t('settings.editor.overrideInProject')}
            </Button>
          ) : null}
          {specialist && sources.project && !sources.global && !readOnly ? (
            <Button variant="outline" disabled={busy} onClick={() => void copyTo('global')}>
              {t('settings.editor.makeGlobal')}
            </Button>
          ) : null}
          {specialist && !readOnly ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSaveAs(saveAs === null ? '' : null)}
            >
              {t('settings.editor.saveAs')}
            </Button>
          ) : null}
          {specialist && source && !readOnly ? (
            <Button
              variant="destructive"
              disabled={busy || removeBlocked}
              title={removeBlocked ? removeBlockedReason : undefined}
              onClick={() => void remove()}
            >
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
      {removeBlocked && specialist ? (
        <p className="text-sm text-muted-foreground" data-testid="delete-blocked">
          {removeBlockedReason}
        </p>
      ) : null}
      {readOnly ? <Alert role="status">{t('specialists.sharedReadOnly')}</Alert> : null}
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
              <li key={describeReference(reference, view)}>{describeReference(reference, view)}</li>
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
            components={{ code: <code className={FILE_PATH_CLASS} title={sources.global.file} /> }}
          />
        </p>
      ) : null}
      {sharedOnly && specialist ? <UsageBlock shared={sharedOnly} view={view} /> : null}
      <SpecialistFields
        draft={draft}
        onDraft={(update) => setDraft(update)}
        disabled={readOnly || busy}
        errors={errors}
        prefix={prefix}
        defaults={defaults}
        catalog={catalog}
        catalogError={catalogError}
        tags={tagsInput()}
        tagsHelp={level === 'global' ? t('specialists.tags.sharedOnly') : undefined}
        mainStart={
          !specialist ? (
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
          ) : null
        }
      />
    </section>
  );
}
