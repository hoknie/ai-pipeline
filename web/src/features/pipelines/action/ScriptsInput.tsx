import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import { useListDrag } from '../../../shared/lib/browser/useListDrag.ts';
import { moveId } from '../../../shared/lib/listOrder.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Textarea } from '../../../shared/ui/forms/textarea.tsx';
import { newScript, type ScriptDraft } from './actionDraft.ts';

/** One script: the grip to drag it, its text and removing it. */
function ScriptRow({
  script,
  index,
  last,
  disabled,
  drag,
  onText,
  onRemove,
}: {
  script: ScriptDraft;
  index: number;
  /** The only script of the list cannot be removed. */
  last: boolean;
  disabled: boolean;
  drag: ReturnType<typeof useListDrag>;
  onText: (text: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      className={cn(
        'flex items-start gap-2',
        drag.dragging === script.key && 'opacity-50',
        drag.drop?.index === index &&
          (drag.drop.after ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
      )}
      data-id={script.key}
      tabIndex={0}
      onDragOver={(event) => drag.onDragOver(event, index)}
      onDrop={(event) => drag.onDrop(event, index)}
      onKeyDown={(event) => {
        if (!disabled) drag.onKeyDown(event, script.key, index);
      }}
    >
      {/* only the grip drags: a drag inside the text field must select text */}
      <span
        className="mt-2 cursor-grab text-muted-foreground"
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', script.key);
          event.dataTransfer.effectAllowed = 'move';
          drag.setDragging(script.key);
        }}
        onDragEnd={drag.onDragEnd}
      >
        <GripVertical className="size-4" aria-hidden="true">
          <title>{t('pipeline.actions.dragScript')}</title>
        </GripVertical>
      </span>
      <Textarea
        id={index === 0 ? 'field-action-run' : undefined}
        rows={2}
        className="min-w-0 flex-1 font-mono"
        aria-label={t('pipeline.actions.scripts', { n: index + 1 })}
        value={script.text}
        disabled={disabled}
        placeholder={index === 0 ? 'git commit -am "$AIP_COMMIT_MESSAGE"' : undefined}
        onChange={(event) => onText(event.target.value)}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('pipeline.actions.removeScript', { n: index + 1 })}
        disabled={disabled || last}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/** The scripts of a command in order: edit, add, remove, and move by the grip or Alt+arrows. */
export function ScriptsInput({
  scripts,
  disabled,
  onScripts,
}: {
  scripts: ScriptDraft[];
  disabled: boolean;
  onScripts: (scripts: ScriptDraft[]) => void;
}) {
  const { t } = useTranslation();
  const keys = scripts.map((script) => script.key);
  const drag = useListDrag(keys, (key, position) => {
    const from = keys.indexOf(key);
    // the edges of the list and the row's own place change nothing
    if (from === -1 || position < 1 || position > keys.length || position - 1 === from) return;
    const order = moveId(keys, from, position);
    onScripts(order.map((next) => scripts.find((script) => script.key === next)!));
  });
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {scripts.map((script, index) => (
          <ScriptRow
            key={script.key}
            script={script}
            index={index}
            last={scripts.length === 1}
            disabled={disabled}
            drag={drag}
            onText={(text) =>
              onScripts(scripts.map((item) => (item.key === script.key ? { ...item, text } : item)))
            }
            onRemove={() => onScripts(scripts.filter((item) => item.key !== script.key))}
          />
        ))}
      </ol>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => onScripts([...scripts, newScript()])}
      >
        <Plus />
        {t('pipeline.actions.addScript')}
      </Button>
    </div>
  );
}
