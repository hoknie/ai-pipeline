import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import {
  isCommandAction,
  type ActionEntry,
  type ActionKind,
  type ActionReference,
} from '../pipelineEntries.ts';
import { repositoryLabel } from '../repositories.ts';
import { Alert } from '../ui/alert.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';
import type { ConfigEditorResponse, FieldError, WriteLevel } from '../types.ts';

import { FilePath } from './FilePath.tsx';

/** Radix `Select` has no empty value: this one stands for «nothing chosen». */
const NONE = '__none';

const FIELDS = ['name', 'run', 'specialist', 'additional_prompt', 'timeout', 'on_failure'] as const;
type Field = (typeof FIELDS)[number];

export interface ActionDraft {
  name: string;
  kind: ActionKind;
  run: string;
  /** Seconds as typed; empty: the default. */
  timeout: string;
  specialist: string;
  additionalPrompt: string;
  /** Empty: the default (`stop`). */
  onFailure: '' | 'stop' | 'continue';
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function draftOfAction(raw: Record<string, unknown>): ActionDraft {
  return {
    name: text(raw.name),
    kind: isCommandAction(raw) ? 'command' : 'specialist',
    run: text(raw.run),
    timeout: text(raw.timeout),
    specialist: text(raw.specialist),
    additionalPrompt: text(raw.additional_prompt),
    onFailure: raw.on_failure === 'stop' || raw.on_failure === 'continue' ? raw.on_failure : '',
  };
}

const asNumber = (value: string): number | string =>
  /^\d+$/.test(value.trim()) ? Number(value) : value.trim();

/** The file content of a draft: only the fields of the chosen type. */
export function valueOfAction(draft: ActionDraft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (draft.name.trim() !== '') value.name = draft.name.trim();
  if (draft.kind === 'command') {
    value.run = draft.run;
    if (draft.timeout.trim() !== '') value.timeout = asNumber(draft.timeout);
  } else {
    value.specialist = draft.specialist;
    if (draft.additionalPrompt !== '') value.additional_prompt = draft.additionalPrompt;
  }
  if (draft.onFailure !== '') value.on_failure = draft.onFailure;
  return value;
}

/** The field a path of the check points at: `swarm.actions.<id>.<field>`. */
function fieldOf(path: string, id: string): Field | null {
  const prefix = `swarm.actions.${id}.`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).split(/[.[]/)[0];
  return FIELDS.find((field) => field === name) ?? null;
}

/** A place that names an action, as the text of a line. */
export function describeActionReference(
  reference: ActionReference,
  view: ConfigEditorResponse | null,
): string {
  const point = reference.point ?? '';
  const where = (() => {
    if (!reference.pipeline) return `swarm.stages.${point}`;
    const entry = reference.repository
      ? undefined
      : view?.pipelines.find((candidate) => candidate.id === reference.pipeline);
    const name = typeof entry?.raw.name === 'string' ? entry.raw.name : reference.pipeline;
    return `${name} → stages.${point}`;
  })();
  return reference.repository ? `${repositoryLabel(reference.repository)}: ${where}` : where;
}

export function ActionForm({
  api,
  view,
  action,
  notice,
  onDirty,
  onReload,
  onSaved,
  onDeleted,
}: {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new action. */
  action: ActionEntry | null;
  notice: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [level, setLevel] = useState<WriteLevel>(action?.level === 'global' ? 'global' : 'project');
  const sources = action?.sources ?? {};
  const source = sources[level];
  const raw = source?.raw ?? action?.raw ?? {};
  const initial = useMemo(() => draftOfAction(raw), [raw]);
  const initialValue = useMemo(() => JSON.stringify(valueOfAction(initial)), [initial]);
  const [draft, setDraft] = useState<ActionDraft>(initial);
  const [newId, setNewId] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [references, setReferences] = useState<ActionReference[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = action?.id ?? newId;
  const value = useMemo(() => valueOfAction(draft), [draft]);
  const dirty = JSON.stringify(value) !== initialValue || (!action && newId !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const update = (patch: Partial<ActionDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const slugs = view.specialists.map((specialist) => specialist.slug);
  if (draft.specialist !== '' && !slugs.includes(draft.specialist)) slugs.push(draft.specialist);

  const attempt = async (run: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await run();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const report = (result: Awaited<ReturnType<Api['writeAction']>>): boolean => {
    if (result.ok) return true;
    if (result.reason === 'conflict') setConflict(result.message);
    else {
      setErrors(result.errors);
      setReferences((result.references ?? []) as ActionReference[]);
    }
    return false;
  };

  const save = () =>
    attempt(async () => {
      setConflict(null);
      setErrors([]);
      setReferences([]);
      const result = await api.writeAction(
        id,
        value,
        action ? (source?.revision ?? null) : null,
        level,
      );
      if (report(result)) await onSaved(id);
    });

  const remove = () =>
    attempt(async () => {
      if (!action || !source) return;
      const label = t('settings.editor.remove');
      const yes = await confirm({
        title: t('settings.editor.removeTitle', { action: label, id: action.id }),
        description: t('settings.editor.removeDescription', { file: source.file }),
        confirmLabel: label,
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      setErrors([]);
      setReferences([]);
      setConflict(null);
      const result = await api.deleteAction(action.id, source.revision, level);
      if (report(result)) await onDeleted();
    });

  const reread = async () => {
    onDirty(false);
    await onReload();
  };

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
    setReferences([]);
    setConflict(null);
    setDraft(draftOfAction(action?.sources[next]?.raw ?? action?.raw ?? {}));
    setLevel(next);
  };

  const fieldErrors = (field: Field) => errors.filter((error) => fieldOf(error.path, id) === field);
  const otherErrors = errors.filter((error) => fieldOf(error.path, id) === null);
  const shownErrors = (field: Field) =>
    fieldErrors(field).map((error) => (
      <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
        {error.message}
      </p>
    ));

  const disabled = busy;
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('pipeline.actions.section', { id: id || t('pipeline.actions.newName') })}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {action
            ? typeof action.raw.name === 'string' && action.raw.name !== ''
              ? action.raw.name
              : action.id
            : t('pipeline.actions.new')}
        </h2>
        {action ? <FilePath variant="line" path={source?.file ?? action.file} /> : null}
      </div>
      {notice ? <Alert role="status">{notice}</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-2">
          <p>{t('settings.editor.conflict', { message: conflict })}</p>
          <Button variant="outline" size="sm" onClick={() => void reread()}>
            {t('pipeline.actions.reread')}
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
        <Alert variant="destructive" data-testid="action-references">
          <p>{t('pipeline.actions.usedBy')}</p>
          <ul className="list-disc pl-4">
            {references.map((reference) => {
              const line = describeActionReference(reference, view);
              return <li key={line}>{line}</li>;
            })}
          </ul>
        </Alert>
      ) : null}

      <ToggleGroup
        type="single"
        value={level}
        aria-label={t('settings.editor.level')}
        onValueChange={(next) => {
          if (next) void switchLevel(next as WriteLevel);
        }}
      >
        <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
        <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
      </ToggleGroup>
      <p className="text-sm text-muted-foreground">
        {level === 'global' ? t('settings.editor.globalHint') : t('pipeline.actions.projectHint')}
      </p>

      {!action ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-action-id">Id</Label>
          <Input
            id="field-action-id"
            type="text"
            value={newId}
            disabled={disabled}
            placeholder="commit"
            onChange={(event) => setNewId(event.target.value)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-action-name">{t('pipeline.actions.name')}</Label>
        <Input
          id="field-action-name"
          type="text"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => update({ name: event.target.value })}
        />
        {shownErrors('name')}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label id="action-kind-label">{t('pipeline.actions.kind')}</Label>
        <ToggleGroup
          type="single"
          value={draft.kind}
          aria-labelledby="action-kind-label"
          onValueChange={(next) => {
            if (next) update({ kind: next as ActionKind });
          }}
        >
          <ToggleGroupItem value="command" disabled={disabled}>
            {t('pipeline.actions.command')}
          </ToggleGroupItem>
          <ToggleGroupItem value="specialist" disabled={disabled}>
            {t('pipeline.actions.specialist')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {draft.kind === 'command' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-action-run">{t('pipeline.actions.run')}</Label>
            <Textarea
              id="field-action-run"
              rows={3}
              className="font-mono"
              value={draft.run}
              disabled={disabled}
              placeholder='git commit -am "$AIP_COMMIT_MESSAGE"'
              onChange={(event) => update({ run: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('pipeline.actions.runHelp')}</p>
            {shownErrors('run')}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-action-timeout">{t('pipeline.actions.timeout')}</Label>
            <Input
              id="field-action-timeout"
              type="text"
              className="w-32"
              value={draft.timeout}
              disabled={disabled}
              placeholder="600"
              onChange={(event) => update({ timeout: event.target.value })}
            />
            {shownErrors('timeout')}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>{t('pipeline.actions.specialistField')}</Label>
            <Select
              value={draft.specialist === '' ? NONE : draft.specialist}
              disabled={disabled}
              onValueChange={(next) => update({ specialist: next === NONE ? '' : next })}
            >
              <SelectTrigger aria-label={t('pipeline.actions.specialistLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {slugs.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    {slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {shownErrors('specialist')}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-action-prompt">{t('pipeline.actions.prompt')}</Label>
            <Textarea
              id="field-action-prompt"
              rows={3}
              value={draft.additionalPrompt}
              disabled={disabled}
              onChange={(event) => update({ additionalPrompt: event.target.value })}
            />
            {shownErrors('additional_prompt')}
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{t('pipeline.actions.onFailure')}</Label>
        <Select
          value={draft.onFailure === '' ? NONE : draft.onFailure}
          disabled={disabled}
          onValueChange={(next) =>
            update({ onFailure: next === NONE ? '' : (next as 'stop' | 'continue') })
          }
        >
          <SelectTrigger aria-label={t('pipeline.actions.onFailureLabel')} className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('pipeline.actions.failureDefault')}</SelectItem>
            <SelectItem value="stop">{t('pipeline.actions.failureStop')}</SelectItem>
            <SelectItem value="continue">{t('pipeline.actions.failureContinue')}</SelectItem>
          </SelectContent>
        </Select>
        {shownErrors('on_failure')}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || (!action && !newId)} onClick={() => void save()}>
          {t('settings.editor.save')}
        </Button>
        {action && source ? (
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {t('settings.editor.remove')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
