import { useTranslation } from 'react-i18next';

import type { EditorPipeline, WriteLevel } from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';

export interface ButtonsProps {
  pipeline: EditorPipeline | null;
  readOnly: boolean;
  busy: boolean;
  canSave: boolean;
  overrideInProject: boolean;
  makeGlobal: boolean;
  canRemove: boolean;
  removeBlocked: boolean;
  removeBlockedReason: string;
  removeLabel: string;
  saveAs: string | null;
  onSave: () => void;
  onCopyTo: (level: WriteLevel) => void;
  onSaveAs: (value: string | null) => void;
  onSaveCopy: () => void;
  onRemove: () => void;
}

/** The buttons under the form, the reason a delete is blocked and the row for a copy. */
export function PipelineButtons(props: ButtonsProps) {
  const { t } = useTranslation();
  const { pipeline, readOnly, busy, saveAs } = props;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {readOnly ? null : (
          <Button disabled={busy || !props.canSave} onClick={props.onSave}>
            {t('settings.editor.save')}
          </Button>
        )}
        {props.overrideInProject ? (
          <Button variant="outline" disabled={busy} onClick={() => props.onCopyTo('project')}>
            {t('settings.editor.overrideInProject')}
          </Button>
        ) : null}
        {props.makeGlobal ? (
          <Button variant="outline" disabled={busy} onClick={() => props.onCopyTo('global')}>
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
            onClick={() => props.onSaveAs(saveAs === null ? '' : null)}
          >
            {t('settings.editor.saveAs')}
          </Button>
        ) : null}
        {props.canRemove ? (
          <Button
            variant="destructive"
            disabled={busy || props.removeBlocked}
            title={props.removeBlocked ? props.removeBlockedReason : undefined}
            onClick={props.onRemove}
          >
            {props.removeLabel}
          </Button>
        ) : null}
      </div>
      {props.removeBlocked && pipeline ? (
        <p className="text-sm text-muted-foreground" data-testid="delete-blocked">
          {props.removeBlockedReason}
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
              onChange={(event) => props.onSaveAs(event.target.value)}
            />
            <Button variant="outline" disabled={busy || saveAs === ''} onClick={props.onSaveCopy}>
              {t('settings.editor.createCopy')}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
