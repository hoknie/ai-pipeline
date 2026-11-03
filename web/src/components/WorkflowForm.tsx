import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ArrowDown, ArrowUp, GitBranch, Trash2 } from 'lucide-react';

import type { Api } from '../api.ts';
import { useConfirm } from '../confirm.tsx';
import { Alert } from '../ui/alert.tsx';
import { Badge } from '../ui/badge.tsx';
import { Button } from '../ui/button.tsx';
import { Card } from '../ui/card.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.tsx';
import { Switch } from '../ui/switch.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.tsx';
import type {
  ConfigEditorResponse,
  EditorWorkflow,
  FieldError,
  WorkflowTopology,
  WriteLevel,
} from '../types.ts';

import { FILE_PATH_CLASS, FilePath } from './FilePath.tsx';
import { stepIds } from './stepIds.ts';
import { WorkflowGraph } from './WorkflowGraph.tsx';

export const PREVIEW_DELAY_MS = 300;

/** Radix `Select` has no empty value: this one stands for «nothing chosen». */
const NONE = '__none';

export interface StepDraft {
  /** Stable while the step is renamed or moved, so React keeps the focus. */
  key: number;
  /** The id is the specialist's slug (with a suffix when repeated). */
  autoId: boolean;
  /** The own id from the file, kept as it is when `autoId` is false. */
  fixedId: string;
  specialist: string;
  /** The step to return to, by key, so a rename keeps the link. */
  gotoKey: number | null;
  /** A goto that names no step of the draft; sent as it is, the check reports it. */
  gotoRaw: string;
  maxRounds: string;
  additionalPrompt: string;
}

export interface SplitDraft {
  specialist: string;
  maxGroups: string;
  /** Workflow whose steps the groups follow; empty for the own steps. */
  workflow: string;
  additionalPrompt: string;
}

export interface Draft {
  steps: StepDraft[];
  split: SplitDraft | null;
}

let nextKey = 1;

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function draftOf(raw: Record<string, unknown>): Draft {
  const list = Array.isArray(raw.steps) ? raw.steps.map(record) : [];
  const steps: StepDraft[] = list.map((step) => {
    const onReject = record(step.on_reject);
    return {
      key: nextKey++,
      autoId: false,
      fixedId: text(step.id),
      specialist: text(step.specialist),
      gotoKey: null,
      gotoRaw: text(onReject.goto),
      maxRounds: text(onReject.max_rounds),
      additionalPrompt: text(step.additional_prompt),
    };
  });
  const derived = stepIds(steps.map((step) => ({ ...step, autoId: true })));
  const original = steps.map((step) => step.fixedId);
  for (const [index, step] of steps.entries()) {
    if (original[index] === derived[index]) step.autoId = true;
  }
  // A step stays automatic only if the final ids give it exactly its id from the file;
  // returning a step to its own id can change the others, so repeat until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    const final = stepIds(steps);
    for (const [index, step] of steps.entries()) {
      if (step.autoId && final[index] !== original[index]) {
        step.autoId = false;
        changed = true;
      }
    }
  }
  for (const [index, step] of steps.entries()) {
    step.fixedId = step.autoId ? '' : (original[index] ?? '');
  }
  const ids = stepIds(steps);
  for (const step of steps) {
    const target = steps.find((_, index) => ids[index] === step.gotoRaw);
    if (target && step.gotoRaw !== '') {
      step.gotoKey = target.key;
      step.gotoRaw = '';
    }
  }
  const split = raw.split === undefined ? null : record(raw.split);
  return {
    steps,
    split: split
      ? {
          specialist: text(split.specialist),
          maxGroups: text(split.max_groups),
          workflow: text(split.workflow),
          additionalPrompt: text(split.additional_prompt),
        }
      : null,
  };
}

const asNumber = (value: string): number | string =>
  /^\d+$/.test(value.trim()) ? Number(value) : value.trim();

/** The file content of a draft; the key order of the existing file is kept by the writer. */
export function valueOf(draft: Draft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (draft.split) {
    const split: Record<string, unknown> = { specialist: draft.split.specialist };
    if (draft.split.maxGroups.trim() !== '') split.max_groups = asNumber(draft.split.maxGroups);
    if (draft.split.additionalPrompt !== '') split.additional_prompt = draft.split.additionalPrompt;
    if (draft.split.workflow !== '') split.workflow = draft.split.workflow;
    value.split = split;
  }
  if (draft.split?.workflow) return value;
  const ids = stepIds(draft.steps);
  value.steps = draft.steps.map((step, index) => {
    const out: Record<string, unknown> = { id: ids[index], specialist: step.specialist };
    const target =
      step.gotoKey === null
        ? step.gotoRaw
        : (ids[draft.steps.findIndex((candidate) => candidate.key === step.gotoKey)] ?? '');
    if (target !== '') {
      const onReject: Record<string, unknown> = { goto: target };
      if (step.maxRounds.trim() !== '') onReject.max_rounds = asNumber(step.maxRounds);
      out.on_reject = onReject;
    }
    if (step.additionalPrompt !== '') out.additional_prompt = step.additionalPrompt;
    return out;
  });
  return value;
}

function stepOfError(
  path: string,
  id: string,
  hasSplit: boolean,
): { step: number | null; split: boolean } {
  const prefix = `swarm.workflows.${id}.`;
  if (!path.startsWith(prefix)) return { step: null, split: false };
  const rest = path.slice(prefix.length);
  const step = /^steps\[(\d+)\]/.exec(rest);
  if (step) return { step: Number(step[1]), split: false };
  // Errors of the whole list of steps belong to the choice of group steps.
  if (rest === 'steps') return { step: null, split: hasSplit };
  return { step: null, split: rest === 'split' || rest.startsWith('split.') };
}

function fieldLabel(path: string): string {
  const match = /steps\[\d+\]\.(.+)$|split\.(.+)$|\.(steps)$/.exec(path);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function movedBy(steps: StepDraft[], index: number, delta: number): StepDraft[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const copy = [...steps];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved as StepDraft);
  return copy;
}

export function WorkflowForm({
  api,
  view,
  workflow,
  activeRuns,
  notice,
  onDirty,
  onReload,
  onSaved,
  onDeleted,
}: {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new workflow. */
  workflow: EditorWorkflow | null;
  activeRuns: number;
  notice: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [level, setLevel] = useState<WriteLevel>(
    workflow?.level === 'global' ? 'global' : 'project',
  );
  const sources = workflow?.sources ?? {};
  const source = sources[level];
  const bothLevels = Boolean(sources.project && sources.global);
  // A level without a file starts from the file that applies.
  const raw = source?.raw ?? workflow?.raw ?? {};
  const initial = useMemo(() => draftOf(raw), [raw]);
  const initialValue = useMemo(() => JSON.stringify(valueOf(initial)), [initial]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [newId, setNewId] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('form');
  const [preview, setPreview] = useState<{ topology: WorkflowTopology | null; stale: boolean }>({
    topology: null,
    stale: false,
  });

  const id = workflow?.id ?? newId;
  const readOnly = false;
  const value = useMemo(() => valueOf(draft), [draft]);
  const dirty = JSON.stringify(value) !== initialValue || (!workflow && newId !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  // The preview follows the draft; answers to an older draft are dropped.
  const latest = useRef(0);
  useEffect(() => {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) return;
    const request = ++latest.current;
    const timer = setTimeout(() => {
      api.previewWorkflow(id, value, level).then(
        (result) => {
          if (request !== latest.current) return;
          setErrors(result.errors);
          setPreview((current) =>
            result.topology
              ? { topology: result.topology, stale: false }
              : { topology: current.topology, stale: true },
          );
        },
        (error: Error) => {
          if (request === latest.current) setProblem(error.message);
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, id, value, level]);

  const ids = stepIds(draft.steps);
  const slugs = view.specialists.map((specialist) => specialist.slug);
  const update = (change: (current: Draft) => Draft) => setDraft(change);
  const setStep = (key: number, patch: Partial<StepDraft>) =>
    update((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.key === key ? { ...step, ...patch } : step)),
    }));
  const setSplit = (patch: Partial<SplitDraft> | null) =>
    update((current) => ({
      ...current,
      split:
        patch === null
          ? null
          : {
              specialist: '',
              maxGroups: '',
              workflow: '',
              additionalPrompt: '',
              ...current.split,
              ...patch,
            },
    }));

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

  const report = (result: Awaited<ReturnType<Api['writeWorkflow']>>): boolean => {
    if (result.ok) return true;
    if (result.reason === 'conflict') setConflict(result.message);
    else setErrors(result.errors);
    return false;
  };

  const save = () =>
    attempt(async () => {
      setConflict(null);
      const result = await api.writeWorkflow(
        id,
        value,
        workflow ? (source?.revision ?? null) : null,
        level,
      );
      if (report(result)) await onSaved(id);
    });

  const saveCopy = () =>
    attempt(async () => {
      setConflict(null);
      const target = saveAs ?? '';
      const result = await api.writeWorkflow(target, value, null, level);
      if (report(result)) await onSaved(target);
    });

  /** Copies the file that applies to the other level, which has none. */
  const copyTo = (target: WriteLevel) =>
    attempt(async () => {
      const result = await api.writeWorkflow(id, workflow?.raw ?? {}, null, target);
      if (report(result)) await onSaved(id);
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
    setDraft(draftOf(workflow?.sources[next]?.raw ?? workflow?.raw ?? {}));
    setLevel(next);
  };

  const removeLabel =
    level === 'project' && sources.global
      ? t('settings.editor.removeOverride')
      : t('settings.editor.remove');

  const remove = () =>
    attempt(async () => {
      if (!workflow || !source) return;
      const label = removeLabel;
      const running = activeRuns > 0 ? t('workflows.runningRuns', { count: activeRuns }) : '';
      const yes = await confirm({
        title: t('settings.editor.removeTitle', { action: label, id: workflow.id }),
        description: `${t('settings.editor.removeDescription', { file: source.file })}${running}`,
        confirmLabel: label,
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      const result = await api.deleteWorkflow(workflow.id, source.revision, level);
      if (report(result)) await onDeleted();
    });

  const reread = async () => {
    if (
      dirty &&
      !(await confirm({
        title: t('workflows.rereadTitle'),
        description: t('settings.editor.lostValues'),
        confirmLabel: t('settings.editor.reread'),
        destructive: true,
      }))
    )
      return;
    onDirty(false);
    await onReload();
  };

  const stepErrors = (index: number) =>
    errors.filter((error) => stepOfError(error.path, id, draft.split !== null).step === index);
  const splitErrors = errors.filter(
    (error) => stepOfError(error.path, id, draft.split !== null).split,
  );
  const otherErrors = errors.filter((error) => {
    const place = stepOfError(error.path, id, draft.split !== null);
    return place.step === null && !place.split;
  });

  const targets = view.workflows
    .filter((candidate) => candidate.id !== id && !record(record(candidate.raw).split).workflow)
    .map((candidate) => candidate.id);
  const ownTarget = draft.split?.workflow ?? '';
  if (ownTarget !== '' && !targets.includes(ownTarget)) targets.push(ownTarget);

  const specialistSelect = (current: string, onChange: (next: string) => void, label: string) => (
    <Select
      value={current === '' ? NONE : current}
      disabled={readOnly || busy}
      onValueChange={(next) => onChange(next === NONE ? '' : next)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {[...new Set([...slugs, ...(current && !slugs.includes(current) ? [current] : [])])].map(
          (slug) => (
            <SelectItem key={slug} value={slug}>
              {slug}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('workflows.section', { id: id || t('workflows.newName') })}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{workflow ? workflow.id : t('workflows.new')}</h2>
        {workflow ? <FilePath variant="line" path={source?.file ?? workflow.file} /> : null}
      </div>
      {notice ? <Alert role="status">{notice}</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-2">
          <p>{t('settings.editor.conflict', { message: conflict })}</p>
          <Button variant="outline" size="sm" onClick={() => void reread()}>
            {t('workflows.reread')}
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
      {(workflow && bothLevels) || !workflow ? (
        <ToggleGroup
          type="single"
          value={level}
          aria-label={t('settings.editor.level')}
          onValueChange={(value) => {
            if (!value) return;
            if (workflow) void switchLevel(value as WriteLevel);
            else setLevel(value as WriteLevel);
          }}
        >
          <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
          <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
        </ToggleGroup>
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
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('workflows.tabs')}>
          <TabsTrigger value="form">{t('workflows.form')}</TabsTrigger>
          <TabsTrigger value="preview">
            {t('workflows.preview')}{' '}
            {preview.stale ? <Badge variant="warn">{t('workflows.stale')}</Badge> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="flex min-w-0 flex-col gap-3">
          {!workflow ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-workflow-id">Id</Label>
              <Input
                id="field-workflow-id"
                type="text"
                value={newId}
                disabled={busy}
                placeholder="feature"
                onChange={(event) => setNewId(event.target.value)}
              />
            </div>
          ) : null}

          <fieldset
            className="flex flex-col gap-2 rounded-lg border p-3"
            disabled={readOnly || busy}
          >
            <legend className="px-1 text-sm font-medium">{t('workflows.split')}</legend>
            <div className="flex items-center gap-2">
              <Switch
                id="split-enabled"
                checked={draft.split !== null}
                disabled={readOnly || busy}
                onCheckedChange={(on) => setSplit(on ? {} : null)}
                aria-label={t('workflows.split')}
              />
              <Label htmlFor="split-enabled">
                {draft.split ? t('workflows.removeSplit') : t('workflows.addSplit')}
              </Label>
            </div>
            {draft.split ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('workflows.splitSpecialist')}</Label>
                  {specialistSelect(
                    draft.split.specialist,
                    (next) => setSplit({ specialist: next }),
                    t('workflows.splitSpecialistLabel'),
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="split-max">{t('workflows.maxGroups')}</Label>
                  <Input
                    id="split-max"
                    type="text"
                    value={draft.split.maxGroups}
                    onChange={(event) => setSplit({ maxGroups: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('workflows.groupSteps')}</Label>
                  <Select
                    value={draft.split.workflow === '' ? NONE : draft.split.workflow}
                    disabled={readOnly || busy}
                    onValueChange={(next) => setSplit({ workflow: next === NONE ? '' : next })}
                  >
                    <SelectTrigger aria-label={t('workflows.groupStepsLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('workflows.ownSteps')}</SelectItem>
                      {targets.map((target) => (
                        <SelectItem key={target} value={target}>
                          {target}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="split-prompt">{t('workflows.splitPrompt')}</Label>
                  <Textarea
                    id="split-prompt"
                    rows={2}
                    value={draft.split.additionalPrompt}
                    onChange={(event) => setSplit({ additionalPrompt: event.target.value })}
                  />
                </div>
                {splitErrors.map((error) => (
                  <p
                    className="text-sm text-destructive"
                    role="alert"
                    key={`${error.path}:${error.message}`}
                  >
                    {fieldLabel(error.path)}: {error.message}
                  </p>
                ))}
              </>
            ) : null}
          </fieldset>

          {draft.split?.workflow ? (
            <p className="text-sm">
              {t('workflows.groupsFollow')}{' '}
              <a
                className="underline"
                href={`#workflows/${encodeURIComponent(draft.split.workflow)}`}
              >
                {draft.split.workflow}
              </a>
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-2" aria-label={t('workflows.steps')}>
                {draft.steps.map((step, index) => {
                  const earlier = draft.steps.slice(0, index);
                  const target = draft.steps.find((candidate) => candidate.key === step.gotoKey);
                  const options =
                    target && !earlier.includes(target) ? [...earlier, target] : earlier;
                  return (
                    <li key={step.key} aria-label={t('workflows.step', { index: index + 1 })}>
                      <Card className="flex flex-col gap-2 p-3">
                        <div className="flex items-center gap-2">
                          {specialistSelect(
                            step.specialist,
                            (next) => setStep(step.key, { specialist: next }),
                            t('workflows.stepSpecialist'),
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('workflows.up')}
                            disabled={readOnly || busy || index === 0}
                            onClick={() =>
                              update((c) => ({ ...c, steps: movedBy(c.steps, index, -1) }))
                            }
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('workflows.down')}
                            disabled={readOnly || busy || index === draft.steps.length - 1}
                            onClick={() =>
                              update((c) => ({ ...c, steps: movedBy(c.steps, index, 1) }))
                            }
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('workflows.removeStep')}
                            disabled={readOnly || busy}
                            onClick={() =>
                              update((c) => ({
                                ...c,
                                steps: c.steps
                                  .filter((candidate) => candidate.key !== step.key)
                                  .map((candidate) =>
                                    candidate.gotoKey === step.key
                                      ? { ...candidate, gotoKey: null, gotoRaw: ids[index] ?? '' }
                                      : candidate,
                                  ),
                              }))
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span>{t('workflows.onReject')}</span>
                          <Select
                            value={
                              step.gotoKey === null
                                ? step.gotoRaw
                                  ? '!raw'
                                  : NONE
                                : String(step.gotoKey)
                            }
                            disabled={readOnly || busy}
                            onValueChange={(next) =>
                              setStep(step.key, {
                                gotoKey: next === NONE ? null : Number(next),
                                gotoRaw: '',
                              })
                            }
                          >
                            <SelectTrigger aria-label={t('workflows.gotoStep')} className="w-48">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t('workflows.none')}</SelectItem>
                              {step.gotoKey === null && step.gotoRaw ? (
                                <SelectItem value="!raw" disabled>
                                  {t('workflows.missingStep', { id: step.gotoRaw })}
                                </SelectItem>
                              ) : null}
                              {options.map((option) => (
                                <SelectItem key={option.key} value={String(option.key)}>
                                  {ids[draft.steps.indexOf(option)] ||
                                    t('workflows.step', { index: draft.steps.indexOf(option) + 1 })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {step.gotoKey !== null || step.gotoRaw ? (
                            <label className="flex items-center gap-2">
                              {t('workflows.rounds')}
                              <Input
                                aria-label={t('workflows.roundsLabel')}
                                type="text"
                                className="w-16"
                                value={step.maxRounds}
                                disabled={readOnly || busy}
                                onChange={(event) =>
                                  setStep(step.key, { maxRounds: event.target.value })
                                }
                              />
                            </label>
                          ) : null}
                        </div>
                        <Textarea
                          aria-label={t('workflows.stepPrompt')}
                          rows={2}
                          value={step.additionalPrompt}
                          disabled={readOnly || busy}
                          placeholder={t('workflows.stepPrompt')}
                          onChange={(event) =>
                            setStep(step.key, { additionalPrompt: event.target.value })
                          }
                        />
                        {stepErrors(index).map((error) => (
                          <p
                            className="text-sm text-destructive"
                            role="alert"
                            key={`${error.path}:${error.message}`}
                          >
                            {fieldLabel(error.path)}: {error.message}
                          </p>
                        ))}
                      </Card>
                    </li>
                  );
                })}
              </ol>
              <div>
                <Button
                  variant="outline"
                  disabled={readOnly || busy}
                  onClick={() =>
                    update((c) => ({
                      ...c,
                      steps: [
                        ...c.steps,
                        {
                          key: nextKey++,
                          autoId: true,
                          fixedId: '',
                          specialist: '',
                          gotoKey: null,
                          gotoRaw: '',
                          maxRounds: '',
                          additionalPrompt: '',
                        },
                      ],
                    }))
                  }
                >
                  {t('workflows.addStep')}
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="preview">
          <section className="flex min-w-0 flex-col gap-2" aria-label={t('workflows.previewLabel')}>
            <h3 className="flex items-center gap-2 font-semibold">
              <GitBranch className="size-4" aria-hidden />
              {t('workflows.preview')}{' '}
              {preview.stale ? <Badge variant="warn">{t('workflows.stale')}</Badge> : null}
            </h3>
            {preview.stale ? (
              <p className="text-sm text-muted-foreground">{t('workflows.previewInvalid')}</p>
            ) : null}
            {preview.topology ? (
              <WorkflowGraph
                key={id}
                workflow={preview.topology}
                className="h-[calc(100dvh-16rem)] min-h-[420px]"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('workflows.graphLater')}</p>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || (!workflow && !newId)} onClick={() => void save()}>
          {t('settings.editor.save')}
        </Button>
        {workflow && sources.global && !sources.project ? (
          <Button variant="outline" disabled={busy} onClick={() => void copyTo('project')}>
            {t('settings.editor.overrideInProject')}
          </Button>
        ) : null}
        {workflow && sources.project && !sources.global ? (
          <Button variant="outline" disabled={busy} onClick={() => void copyTo('global')}>
            {t('settings.editor.makeGlobal')}
          </Button>
        ) : null}
        {workflow ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setSaveAs(saveAs === null ? '' : null)}
          >
            {t('settings.editor.saveAs')}
          </Button>
        ) : null}
        {workflow && source ? (
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {removeLabel}
          </Button>
        ) : null}
      </div>
      {saveAs !== null ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-save-as">{t('workflows.newId')}</Label>
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
    </section>
  );
}
