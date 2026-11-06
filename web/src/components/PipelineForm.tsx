import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ArrowDown, ArrowUp, GitBranch, Trash2 } from 'lucide-react';

import type { Api } from '../api.ts';
import {
  ACTION_POINTS,
  SPLIT_POINTS,
  actionsOf,
  isCommandAction,
  ownPointsOf,
  pointsOfStages,
  type ActionPoint,
} from '../pipelineEntries.ts';
import { repositoryLabel } from '../repositories.ts';
import { sameTag } from '../specialistTags.ts';
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
  EditorPipeline,
  EntryReference,
  FieldError,
  SharedPipelineView,
  PipelineTopology,
  WriteLevel,
} from '../types.ts';

import { FILE_PATH_CLASS, FilePath } from './FilePath.tsx';
import { SpecialistTagChip } from './SpecialistTagChip.tsx';
import { describeReference } from './SpecialistForm.tsx';
import { stepIds } from './stepIds.ts';
import { ValuesPicker } from './ValuesPicker.tsx';
import { formatRoute } from '../route.ts';
import { PipelineGraph } from './PipelineGraph.tsx';
import { rawName } from './pipelineName.ts';

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
  humanReview: boolean;
}

export interface SplitDraft {
  specialist: string;
  maxGroups: string;
  /** Pipeline whose steps the groups follow; empty for the own steps. */
  pipeline: string;
  additionalPrompt: string;
}

export interface Draft {
  /** Display name; empty: the file has none. */
  name: string;
  /** Tags of the file being edited. */
  tags: string[];
  steps: StepDraft[];
  split: SplitDraft | null;
  /** Own action lists by point; a point that is absent follows `swarm.stages`. */
  stages: Partial<Record<ActionPoint, string[]>>;
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
      humanReview: step.human_review === true,
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
    name: text(raw.name),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    steps,
    stages: ownPointsOf(raw.stages),
    split: split
      ? {
          specialist: text(split.specialist),
          maxGroups: text(split.max_groups),
          pipeline: text(split.pipeline),
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
  if (draft.name.trim() !== '') value.name = draft.name.trim();
  const tags = draft.tags.map((tag) => tag.trim()).filter((tag) => tag !== '');
  if (tags.length > 0) value.tags = tags;
  if (draft.split) {
    const split: Record<string, unknown> = { specialist: draft.split.specialist };
    if (draft.split.maxGroups.trim() !== '') split.max_groups = asNumber(draft.split.maxGroups);
    if (draft.split.additionalPrompt !== '') split.additional_prompt = draft.split.additionalPrompt;
    if (draft.split.pipeline !== '') split.pipeline = draft.split.pipeline;
    value.split = split;
  }
  const stages: Record<string, string[]> = {};
  for (const point of ACTION_POINTS) {
    const list = draft.stages[point];
    // a pipeline without a split has no points around it
    if (list === undefined || (!draft.split && SPLIT_POINTS.includes(point))) continue;
    stages[point] = list;
  }
  if (Object.keys(stages).length > 0) value.stages = stages;
  if (draft.split?.pipeline) return value;
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
    if (step.humanReview) out.human_review = true;
    return out;
  });
  return value;
}

function stepOfError(
  path: string,
  id: string,
  hasSplit: boolean,
): { step: number | null; split: boolean } {
  const prefix = `swarm.pipelines.${id}.`;
  if (!path.startsWith(prefix)) return { step: null, split: false };
  const rest = path.slice(prefix.length);
  const step = /^steps\[(\d+)\]/.exec(rest);
  if (step) return { step: Number(step[1]), split: false };
  // Errors of the whole list of steps belong to the choice of group steps.
  if (rest === 'steps') return { step: null, split: hasSplit };
  return { step: null, split: rest === 'split' || rest.startsWith('split.') };
}

function isNameError(path: string, id: string): boolean {
  return path === `swarm.pipelines.${id}.name`;
}

function isTagsError(path: string, id: string): boolean {
  return path === `swarm.pipelines.${id}.tags`;
}

/** The shared-level view of the form: the usage of the pipeline by the projects. */
export interface SharedPipelineOnly {
  /** Usage of the open pipeline; null while it is not loaded. */
  usage: SharedPipelineView | null;
  usageError: string | null;
  /** Reads the usage again, for example after the daemon refused a delete. */
  onUsageStale: () => void;
}

function UsageBlock({ shared, view }: { shared: SharedPipelineOnly; view: ConfigEditorResponse }) {
  const { t } = useTranslation();
  const { usage, usageError } = shared;
  return (
    <Card>
      <section aria-labelledby="usage-title" className="flex flex-col gap-2 p-4">
        <h3 id="usage-title" className="text-sm font-semibold">
          {t('sharedPipelines.usage.title')}
        </h3>
        {usageError ? (
          <Alert variant="destructive">
            {t('sharedPipelines.usage.error', { message: usageError })}
          </Alert>
        ) : usage === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('sharedPipelines.usage.loading')}
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="usage-count">
              {t('sharedPipelines.usage.count', { count: usage.projects.length })}
            </p>
            {usage.projects.length === 0 && usage.global.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('sharedPipelines.usage.none')}</p>
            ) : null}
            <ul aria-label={t('sharedPipelines.usage.title')} className="flex flex-col gap-1">
              {usage.global.length > 0 ? (
                <li className="text-sm">
                  <span className="font-medium">{t('sharedPipelines.usage.shared')}</span>:{' '}
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

export function PipelineForm({
  api,
  view,
  pipeline,
  activeRuns,
  notice,
  onDirty,
  onReload,
  onSaved,
  onDeleted,
  sharedOnly,
}: {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new pipeline. */
  pipeline: EditorPipeline | null;
  activeRuns: number;
  notice: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  /** Edits a shared pipeline at the shared level only, with the usage by the projects. */
  sharedOnly?: SharedPipelineOnly;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [level, setLevel] = useState<WriteLevel>(
    sharedOnly || pipeline?.level === 'global' ? 'global' : 'project',
  );
  const sources = pipeline?.sources ?? {};
  const source = sources[level];
  const bothLevels = Boolean(sources.project && sources.global);
  // A level without a file starts from the file that applies.
  const raw = source?.raw ?? pipeline?.raw ?? {};
  const initial = useMemo(() => draftOf(raw), [raw]);
  const initialValue = useMemo(() => JSON.stringify(valueOf(initial)), [initial]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [newId, setNewId] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [references, setReferences] = useState<EntryReference[]>([]);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('form');
  const [preview, setPreview] = useState<{ topology: PipelineTopology | null; stale: boolean }>({
    topology: null,
    stale: false,
  });

  const id = pipeline?.id ?? newId;
  // a shared pipeline is view only on the project page; settings are where it is changed
  const readOnly = Boolean(pipeline) && level === 'global' && !sharedOnly;
  const value = useMemo(() => valueOf(draft), [draft]);
  const dirty = JSON.stringify(value) !== initialValue || (!pipeline && newId !== '');
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
      api.previewPipeline(id, value, level).then(
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
  const slugs = view.specialists
    .filter((specialist) => !sharedOnly || specialist.sources.global)
    .map((specialist) => specialist.slug);
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
              pipeline: '',
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

  const report = (result: Awaited<ReturnType<Api['writePipeline']>>): boolean => {
    if (result.ok) return true;
    if (result.reason === 'conflict') setConflict(result.message);
    else {
      setErrors(result.errors);
      setReferences(result.references ?? []);
      if (sharedOnly && (result.references ?? []).length > 0) sharedOnly.onUsageStale();
    }
    return false;
  };

  const save = () =>
    attempt(async () => {
      setConflict(null);
      const result = await api.writePipeline(
        id,
        value,
        pipeline ? (source?.revision ?? null) : null,
        level,
      );
      if (report(result)) await onSaved(id);
    });

  const saveCopy = () =>
    attempt(async () => {
      setConflict(null);
      const target = saveAs ?? '';
      const result = await api.writePipeline(target, value, null, level);
      if (report(result)) await onSaved(target);
    });

  /** Copies the file that applies to the other level, which has none. */
  const copyTo = (target: WriteLevel) =>
    attempt(async () => {
      // tags belong to the file they are written in: the copy starts without them
      const { tags: _tags, ...rest } = pipeline?.raw ?? {};
      const result = await api.writePipeline(id, rest, null, target);
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
    setDraft(draftOf(pipeline?.sources[next]?.raw ?? pipeline?.raw ?? {}));
    setLevel(next);
  };

  const removeBlocked =
    sharedOnly !== undefined &&
    (sharedOnly.usage === null ||
      sharedOnly.usage.projects.length > 0 ||
      sharedOnly.usage.global.length > 0);
  const removeBlockedReason =
    sharedOnly?.usage === null
      ? t('sharedPipelines.usage.waiting')
      : t('sharedPipelines.usage.blocked');

  const removeLabel =
    level === 'project' && sources.global
      ? t('settings.editor.removeOverride')
      : t('settings.editor.remove');

  const remove = () =>
    attempt(async () => {
      if (!pipeline || !source) return;
      const label = removeLabel;
      const running = activeRuns > 0 ? t('pipelines.runningRuns', { count: activeRuns }) : '';
      const yes = await confirm({
        title: t('settings.editor.removeTitle', { action: label, id: pipeline.id }),
        description: `${t('settings.editor.removeDescription', { file: source.file })}${running}`,
        confirmLabel: label,
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      setReferences([]);
      const result = await api.deletePipeline(pipeline.id, source.revision, level);
      if (report(result)) await onDeleted();
    });

  const reread = async () => {
    if (
      dirty &&
      !(await confirm({
        title: t('pipelines.rereadTitle'),
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
    return (
      place.step === null &&
      !place.split &&
      !isNameError(error.path, id) &&
      !isTagsError(error.path, id)
    );
  });
  const tagErrors = errors.filter((error) => isTagsError(error.path, id));
  const nameErrors = errors.filter((error) => isNameError(error.path, id));

  const targets = view.pipelines
    .filter((candidate) => !sharedOnly || candidate.sources.global)
    .filter((candidate) => candidate.id !== id && !record(record(candidate.raw).split).pipeline)
    .map((candidate) => candidate.id);
  const nameOf = (target: string): string =>
    rawName(record(view.pipelines.find((candidate) => candidate.id === target)?.raw)) ?? target;
  const ownTarget = draft.split?.pipeline ?? '';
  if (ownTarget !== '' && !targets.includes(ownTarget)) targets.push(ownTarget);

  const catalog = actionsOf(view).filter((entry) => !sharedOnly || entry.sources.global);
  const nameOfAction = (actionId: string): string => {
    const raw = actionsOf(view).find((entry) => entry.id === actionId)?.raw;
    return typeof raw?.name === 'string' && raw.name !== '' ? raw.name : actionId;
  };
  // a point without a list of its own shows the list it inherits, as the preview computes it
  const inherited = pointsOfStages(
    (preview.topology as { stages?: { id: string; kind: string }[] } | null)?.stages,
  );
  const points = ACTION_POINTS.filter(
    (point) => draft.split !== null || !SPLIT_POINTS.includes(point),
  );
  const listOf = (point: ActionPoint): string[] => draft.stages[point] ?? inherited[point];
  const setPoint = (point: ActionPoint, list: string[] | null) =>
    update((current) => {
      const next = { ...current.stages };
      if (list === null) delete next[point];
      else next[point] = list;
      return { ...current, stages: next };
    });
  const offered = (point: ActionPoint): string[] =>
    catalog
      .filter((entry) => point !== 'after_delivery' || isCommandAction(entry.raw))
      .map((entry) => entry.id)
      .filter((candidate) => !listOf(point).includes(candidate));

  const pointsInput = () => (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border p-3"
      disabled={readOnly || busy}
      data-testid="pipeline-points"
    >
      <legend className="px-1 text-sm font-medium">{t('pipeline.points.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('pipeline.points.help')}</p>
      {points.map((point) => {
        const own = draft.stages[point] !== undefined;
        const list = listOf(point);
        const label = t(`pipeline.points.names.${point}`);
        // the inherited list is known only from the preview: until it arrives the point is not editable
        const unknown = !own && preview.topology === null;
        const options = unknown ? [] : offered(point);
        return (
          <div
            key={point}
            className="flex flex-col gap-1.5"
            role="group"
            aria-label={label}
            data-testid={`point-${point}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{label}</span>
              {own ? null : <Badge variant="outline">{t('pipeline.points.inherited')}</Badge>}
              {own ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={readOnly || busy}
                  onClick={() => setPoint(point, null)}
                >
                  {t('pipeline.points.inherit')}
                </Button>
              ) : null}
            </div>
            {unknown ? (
              <p className="text-xs text-muted-foreground">{t('pipeline.points.loading')}</p>
            ) : list.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {own ? t('pipeline.points.disabled') : t('pipeline.points.none')}
              </p>
            ) : (
              <ol className="flex flex-col gap-1" aria-label={label}>
                {list.map((actionId, index) => (
                  <li key={actionId} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate" title={actionId}>
                      {nameOfAction(actionId)}
                      {!actionsOf(view).some((entry) => entry.id === actionId) ? (
                        <span className="text-destructive"> ({t('pipeline.points.missing')})</span>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('pipeline.points.up', { id: actionId })}
                      disabled={readOnly || busy || index === 0}
                      onClick={() => {
                        const copy = [...list];
                        [copy[index - 1], copy[index]] = [
                          copy[index] as string,
                          copy[index - 1] as string,
                        ];
                        setPoint(point, copy);
                      }}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('pipeline.points.down', { id: actionId })}
                      disabled={readOnly || busy || index === list.length - 1}
                      onClick={() => {
                        const copy = [...list];
                        [copy[index + 1], copy[index]] = [
                          copy[index] as string,
                          copy[index + 1] as string,
                        ];
                        setPoint(point, copy);
                      }}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('pipeline.points.remove', { id: actionId })}
                      disabled={readOnly || busy}
                      onClick={() =>
                        setPoint(
                          point,
                          list.filter((_, at) => at !== index),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {options.length > 0 ? (
              <Select
                value={NONE}
                disabled={readOnly || busy}
                onValueChange={(next) => {
                  if (next !== NONE) setPoint(point, [...list, next]);
                }}
              >
                <SelectTrigger
                  aria-label={t('pipeline.points.add', { point: label })}
                  className="w-64"
                >
                  <SelectValue placeholder={t('pipeline.points.addPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('pipeline.points.addPlaceholder')}</SelectItem>
                  {options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {nameOfAction(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );

  const tagsInput = () => {
    // the shared tags of a pipeline are view only on the project level
    const shared = level === 'global' ? [] : (pipeline?.shared_tags ?? []);
    const suggestions = new Map<string, string>();
    for (const entry of view.pipelines) {
      for (const name of level === 'global' ? entry.shared_tags : entry.own_tags) {
        suggestions.set(name.toLocaleLowerCase(), name);
      }
    }
    return (
      <div className="flex flex-col gap-1.5" data-testid="pipeline-tags">
        <Label htmlFor="field-tags">{t('pipelines.tagsField')}</Label>
        {shared.length > 0 ? (
          <ul aria-label={t('pipelines.tagsSharedList')} className="flex flex-wrap gap-1.5">
            {shared.map((name) => (
              <li key={name}>
                <SpecialistTagChip name={name} shared hint={t('pipelines.tagsSharedHint')} />
              </li>
            ))}
          </ul>
        ) : null}
        <ValuesPicker
          id="field-tags"
          label={t('pipelines.tagsField')}
          values={draft.tags}
          onChange={(tags) => update((current) => ({ ...current, tags }))}
          options={[...suggestions.values()]
            .filter((name) => !shared.some((known) => sameTag(known, name)))
            .map((name) => ({ name, source: 'project' as const }))}
          headings={{ project: t('pipelines.tagsOwn') }}
          disabled={readOnly || busy}
          invalid={tagErrors.length > 0}
        />
        <p className="text-xs text-muted-foreground">{t('pipelines.tagsHelp')}</p>
        {tagErrors.map((error) => (
          <p className="text-sm text-destructive" role="alert" key={error.message}>
            {error.message}
          </p>
        ))}
      </div>
    );
  };

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
      aria-label={t('pipelines.section', { id: id || t('pipelines.newName') })}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {pipeline ? (rawName(pipeline.raw) ?? pipeline.id) : t('pipelines.new')}
        </h2>
        {pipeline ? <FilePath variant="line" path={source?.file ?? pipeline.file} /> : null}
      </div>
      {readOnly ? <Alert role="status">{t('pipelines.sharedReadOnly')}</Alert> : null}
      {notice ? <Alert role="status">{notice}</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-2">
          <p>{t('settings.editor.conflict', { message: conflict })}</p>
          <Button variant="outline" size="sm" onClick={() => void reread()}>
            {t('pipelines.reread')}
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
          <p>{t('sharedPipelines.usage.usedBy')}</p>
          <ul className="list-disc pl-4">
            {references.map((reference) => (
              <li key={describeReference(reference, view)}>{describeReference(reference, view)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {sharedOnly ? (
        <p className="text-sm text-muted-foreground">{t('pipelines.sharedOnlyHint')}</p>
      ) : null}
      {sharedOnly && pipeline ? <UsageBlock shared={sharedOnly} view={view} /> : null}
      {!sharedOnly && pipeline && bothLevels ? (
        <ToggleGroup
          type="single"
          value={level}
          aria-label={t('settings.editor.level')}
          onValueChange={(value) => {
            if (!value) return;
            void switchLevel(value as WriteLevel);
          }}
        >
          <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
          <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      {level === 'global' && !sharedOnly ? (
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
        <TabsList aria-label={t('pipelines.tabs')}>
          <TabsTrigger value="form">{t('pipelines.form')}</TabsTrigger>
          <TabsTrigger value="preview">
            {t('pipelines.preview')}{' '}
            {preview.stale ? <Badge variant="warn">{t('pipelines.stale')}</Badge> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-pipeline-name">{t('pipelines.name')}</Label>
            <Input
              id="field-pipeline-name"
              type="text"
              value={draft.name}
              disabled={readOnly || busy}
              onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
            />
            {nameErrors.map((error) => (
              <p
                className="text-sm text-destructive"
                role="alert"
                key={`${error.path}:${error.message}`}
              >
                {error.message}
              </p>
            ))}
          </div>
          {tagsInput()}
          {!pipeline ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-pipeline-id">Id</Label>
              <Input
                id="field-pipeline-id"
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
            <legend className="px-1 text-sm font-medium">{t('pipelines.split')}</legend>
            <div className="flex items-center gap-2">
              <Switch
                id="split-enabled"
                checked={draft.split !== null}
                disabled={readOnly || busy}
                onCheckedChange={(on) => setSplit(on ? {} : null)}
                aria-label={t('pipelines.split')}
              />
              <Label htmlFor="split-enabled">
                {draft.split ? t('pipelines.removeSplit') : t('pipelines.addSplit')}
              </Label>
            </div>
            {draft.split ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('pipelines.splitSpecialist')}</Label>
                  {specialistSelect(
                    draft.split.specialist,
                    (next) => setSplit({ specialist: next }),
                    t('pipelines.splitSpecialistLabel'),
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="split-max">{t('pipelines.maxGroups')}</Label>
                  <Input
                    id="split-max"
                    type="text"
                    value={draft.split.maxGroups}
                    onChange={(event) => setSplit({ maxGroups: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('pipelines.groupSteps')}</Label>
                  <Select
                    value={draft.split.pipeline === '' ? NONE : draft.split.pipeline}
                    disabled={readOnly || busy}
                    onValueChange={(next) => setSplit({ pipeline: next === NONE ? '' : next })}
                  >
                    <SelectTrigger aria-label={t('pipelines.groupStepsLabel')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('pipelines.ownSteps')}</SelectItem>
                      {targets.map((target) => (
                        <SelectItem key={target} value={target}>
                          {nameOf(target)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="split-prompt">{t('pipelines.splitPrompt')}</Label>
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

          {draft.split?.pipeline ? (
            <p className="text-sm">
              {t('pipelines.groupsFollow')}{' '}
              <a
                className="underline"
                href={formatRoute({
                  view: 'pipelines',
                  run: draft.split.pipeline,
                  group: null,
                  step: null,
                  tab: null,
                })}
              >
                {nameOf(draft.split.pipeline)}
              </a>
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-2" aria-label={t('pipelines.steps')}>
                {draft.steps.map((step, index) => {
                  const earlier = draft.steps.slice(0, index);
                  const target = draft.steps.find((candidate) => candidate.key === step.gotoKey);
                  const options =
                    target && !earlier.includes(target) ? [...earlier, target] : earlier;
                  return (
                    <li key={step.key} aria-label={t('pipelines.step', { index: index + 1 })}>
                      <Card className="flex flex-col gap-2 p-3">
                        <div className="flex items-center gap-2">
                          {specialistSelect(
                            step.specialist,
                            (next) => setStep(step.key, { specialist: next }),
                            t('pipelines.stepSpecialist'),
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('pipelines.up')}
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
                            aria-label={t('pipelines.down')}
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
                            aria-label={t('pipelines.removeStep')}
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
                          <span>{t('pipelines.onReject')}</span>
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
                            <SelectTrigger aria-label={t('pipelines.gotoStep')} className="w-48">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t('pipelines.none')}</SelectItem>
                              {step.gotoKey === null && step.gotoRaw ? (
                                <SelectItem value="!raw" disabled>
                                  {t('pipelines.missingStep', { id: step.gotoRaw })}
                                </SelectItem>
                              ) : null}
                              {options.map((option) => (
                                <SelectItem key={option.key} value={String(option.key)}>
                                  {ids[draft.steps.indexOf(option)] ||
                                    t('pipelines.step', { index: draft.steps.indexOf(option) + 1 })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {step.gotoKey !== null || step.gotoRaw ? (
                            <label className="flex items-center gap-2">
                              {t('pipelines.rounds')}
                              <Input
                                aria-label={t('pipelines.roundsLabel')}
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
                          aria-label={t('pipelines.stepPrompt')}
                          rows={2}
                          value={step.additionalPrompt}
                          disabled={readOnly || busy}
                          placeholder={t('pipelines.stepPrompt')}
                          onChange={(event) =>
                            setStep(step.key, { additionalPrompt: event.target.value })
                          }
                        />
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`review-${step.key}`}
                            checked={step.humanReview}
                            disabled={readOnly || busy}
                            onCheckedChange={(humanReview) => setStep(step.key, { humanReview })}
                          />
                          <Label htmlFor={`review-${step.key}`}>{t('pipelines.humanReview')}</Label>
                        </div>
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
                          humanReview: false,
                        },
                      ],
                    }))
                  }
                >
                  {t('pipelines.addStep')}
                </Button>
              </div>
            </>
          )}
          {pointsInput()}
        </TabsContent>

        <TabsContent value="preview">
          <section className="flex min-w-0 flex-col gap-2" aria-label={t('pipelines.previewLabel')}>
            <h3 className="flex items-center gap-2 font-semibold">
              <GitBranch className="size-4" aria-hidden />
              {t('pipelines.preview')}{' '}
              {preview.stale ? <Badge variant="warn">{t('pipelines.stale')}</Badge> : null}
            </h3>
            {preview.stale ? (
              <p className="text-sm text-muted-foreground">{t('pipelines.previewInvalid')}</p>
            ) : null}
            {preview.topology ? (
              <PipelineGraph
                key={id}
                pipeline={preview.topology}
                className="h-[calc(100dvh-16rem)] min-h-[420px]"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t('pipelines.graphLater')}</p>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        {readOnly ? null : (
          <Button disabled={busy || (!pipeline && !newId)} onClick={() => void save()}>
            {t('settings.editor.save')}
          </Button>
        )}
        {pipeline && !sharedOnly && sources.global && !sources.project ? (
          <Button variant="outline" disabled={busy} onClick={() => void copyTo('project')}>
            {t('settings.editor.overrideInProject')}
          </Button>
        ) : null}
        {pipeline && sources.project && !sources.global && !readOnly ? (
          <Button variant="outline" disabled={busy} onClick={() => void copyTo('global')}>
            {t('settings.editor.makeGlobal')}
          </Button>
        ) : null}
        {readOnly ? (
          <Button variant="outline" asChild>
            <a
              href={formatRoute({
                view: 'settings',
                run: 'pipelines',
                group: 'global',
                step: pipeline?.id ?? null,
                tab: null,
              })}
            >
              {t('pipelines.editInSettings')}
            </a>
          </Button>
        ) : null}
        {pipeline && !readOnly ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setSaveAs(saveAs === null ? '' : null)}
          >
            {t('settings.editor.saveAs')}
          </Button>
        ) : null}
        {pipeline && source && !readOnly ? (
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
      {removeBlocked && pipeline ? (
        <p className="text-sm text-muted-foreground" data-testid="delete-blocked">
          {removeBlockedReason}
        </p>
      ) : null}
      {saveAs !== null ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-save-as">{t('pipelines.newId')}</Label>
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
