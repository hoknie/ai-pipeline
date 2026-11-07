import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../../../shared/api/types.ts';
import {
  ACTION_POINTS,
  SPLIT_POINTS,
  actionsOf,
  isCommandAction,
  pointsOfStages,
  type ActionPoint,
} from '../../../../shared/lib/pipeline/pipelineEntries.ts';
import { Badge } from '../../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';
import { NONE } from '../steps/SpecialistSelect.tsx';

/** Moves the element at `index` by `delta` places. */
function swapped(list: string[], index: number, delta: number): string[] {
  const copy = [...list];
  const other = index + delta;
  [copy[other], copy[index]] = [copy[index] as string, copy[other] as string];
  return copy;
}

function ActionRow({
  actionId,
  name,
  known,
  index,
  list,
  disabled,
  onList,
}: {
  actionId: string;
  name: string;
  known: boolean;
  index: number;
  list: string[];
  disabled: boolean;
  onList: (list: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate" title={actionId}>
        {name}
        {!known ? (
          <span className="text-destructive"> ({t('pipeline.points.missing')})</span>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('pipeline.points.up', { id: actionId })}
        disabled={disabled || index === 0}
        onClick={() => onList(swapped(list, index, -1))}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('pipeline.points.down', { id: actionId })}
        disabled={disabled || index === list.length - 1}
        onClick={() => onList(swapped(list, index, 1))}
      >
        <ArrowDown />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('pipeline.points.remove', { id: actionId })}
        disabled={disabled}
        onClick={() => onList(list.filter((_, at) => at !== index))}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

interface PointProps {
  point: ActionPoint;
  /** The list of the point: its own or the inherited one. */
  list: string[];
  own: boolean;
  /** The inherited list is known only from the preview. */
  unknown: boolean;
  options: string[];
  view: ConfigEditorResponse;
  disabled: boolean;
  /** `null` gives the point back to the inherited list. */
  onList: (list: string[] | null) => void;
}

/** One point: its name, the actions in order, and the choice of one more. */
function PointEditor({ point, list, own, unknown, options, view, disabled, onList }: PointProps) {
  const { t } = useTranslation();
  const label = t(`pipeline.points.names.${point}`);
  const actions = actionsOf(view);
  const nameOfAction = (actionId: string): string => {
    const raw = actions.find((entry) => entry.id === actionId)?.raw;
    return typeof raw?.name === 'string' && raw.name !== '' ? raw.name : actionId;
  };
  return (
    <div
      className="flex flex-col gap-1.5"
      role="group"
      aria-label={label}
      data-testid={`point-${point}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {own ? null : <Badge variant="outline">{t('pipeline.points.inherited')}</Badge>}
        {own ? (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onList(null)}>
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
            <ActionRow
              key={actionId}
              actionId={actionId}
              name={nameOfAction(actionId)}
              known={actions.some((entry) => entry.id === actionId)}
              index={index}
              list={list}
              disabled={disabled}
              onList={onList}
            />
          ))}
        </ol>
      )}
      {options.length > 0 ? (
        <Select
          value={NONE}
          disabled={disabled}
          onValueChange={(next) => {
            if (next !== NONE) onList([...list, next]);
          }}
        >
          <SelectTrigger aria-label={t('pipeline.points.add', { point: label })} className="w-64">
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
}

/** The lists of actions at the points of the pipeline. */
export function PointsInput({
  view,
  hasSplit,
  stages,
  previewStages,
  sharedOnly,
  disabled,
  onPoint,
}: {
  view: ConfigEditorResponse;
  hasSplit: boolean;
  /** The own lists of the draft by point. */
  stages: Partial<Record<ActionPoint, string[]>>;
  /** The stages of the preview, where the inherited lists come from; `null` until it arrives. */
  previewStages: { id: string; kind: string }[] | null | undefined;
  sharedOnly: boolean;
  disabled: boolean;
  onPoint: (point: ActionPoint, list: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const catalog = actionsOf(view).filter((entry) => !sharedOnly || entry.sources.global);
  // a point without a list of its own shows the list it inherits, as the preview computes it
  const inherited = pointsOfStages(previewStages ?? undefined);
  const listOf = (point: ActionPoint): string[] => stages[point] ?? inherited[point];
  const offered = (point: ActionPoint): string[] =>
    catalog
      .filter((entry) => point !== 'after_delivery' || isCommandAction(entry.raw))
      .map((entry) => entry.id)
      .filter((candidate) => !listOf(point).includes(candidate));
  return (
    <fieldset
      className="flex flex-col gap-3 rounded-lg border p-3"
      disabled={disabled}
      data-testid="pipeline-points"
    >
      <legend className="px-1 text-sm font-medium">{t('pipeline.points.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('pipeline.points.help')}</p>
      {ACTION_POINTS.filter((point) => hasSplit || !SPLIT_POINTS.includes(point)).map((point) => {
        const own = stages[point] !== undefined;
        // the inherited list is known only from the preview: until it arrives the point is not editable
        const unknown = !own && previewStages === null;
        return (
          <PointEditor
            key={point}
            point={point}
            list={listOf(point)}
            own={own}
            unknown={unknown}
            options={unknown ? [] : offered(point)}
            view={view}
            disabled={disabled}
            onList={(list) => onPoint(point, list)}
          />
        );
      })}
    </fieldset>
  );
}
