import { useTranslation } from 'react-i18next';

import type { EditorSpecialist, WriteLevel } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../../shared/ui/forms/toggle-group.tsx';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';

function LevelToggle({
  level,
  onChange,
}: {
  level: WriteLevel;
  onChange: (level: WriteLevel) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      value={level}
      aria-label={t('settings.editor.level')}
      onValueChange={(value) => value && onChange(value as WriteLevel)}
    >
      <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
      <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
    </ToggleGroup>
  );
}

export interface HeaderProps {
  specialist: EditorSpecialist | null;
  level: WriteLevel;
  file: string | undefined;
  /** The level can be chosen: a new specialist, or one that has a file on both levels. */
  levelChoice: boolean;
  readOnly: boolean;
  busy: boolean;
  canSave: boolean;
  /** Which copy buttons are offered. */
  overrideInProject: boolean;
  makeGlobal: boolean;
  canRemove: boolean;
  removeBlocked: boolean;
  removeBlockedReason: string;
  removeLabel: string;
  onLevel: (level: WriteLevel) => void;
  onSave: () => void;
  onCopyTo: (level: WriteLevel) => void;
  onSaveAs: () => void;
  onRemove: () => void;
}

/** The sticky bar of the form: the title, the file, the level and the buttons. */
export function SpecialistHeader(props: HeaderProps) {
  const { t } = useTranslation();
  const { specialist, level, busy, readOnly } = props;
  return (
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
      {props.file ? <FilePath variant="line" path={props.file} /> : null}
      {props.levelChoice ? (
        <div className="flex">
          <LevelToggle level={level} onChange={props.onLevel} />
        </div>
      ) : null}
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
        {specialist && !readOnly ? (
          <Button variant="outline" disabled={busy} onClick={props.onSaveAs}>
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
    </header>
  );
}
