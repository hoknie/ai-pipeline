import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type { PipelineSection } from '../../../shared/lib/nav/route.ts';
import { NEW_ID } from '../../specialists/index.ts';

export type Level = 'global' | null;
type Tab = 'pipelines' | 'actions' | 'system';

/** Moves between entries, asking first when the open form has unsaved edits. */
export function usePipelineNavigation(props: {
  selected: string | null;
  section: PipelineSection | null;
  level: Level;
  dirty: RefObject<boolean>;
  onSelect: (id: string | null, section?: PipelineSection | null, level?: 'global' | null) => void;
}) {
  const { selected, section, level, dirty, onSelect } = props;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [notice, setNotice] = useState<string | null>(null);
  // the last open entry of each tab, so that coming back opens it again
  const lastOpen = useRef<Record<Tab, string | undefined>>({
    pipelines: undefined,
    actions: undefined,
    system: undefined,
  });
  useEffect(() => {
    if (selected !== null && selected !== NEW_ID)
      lastOpen.current[section ?? 'pipelines'] = selected;
  }, [selected, section]);

  const go = async (
    id: string | null,
    next: PipelineSection | null = null,
    nextLevel: Level = null,
  ) => {
    if (id === selected && next === section && nextLevel === level) return;
    if (
      dirty.current &&
      !(await confirm({
        title: t('settings.editor.leaveTitle'),
        description: t('settings.editor.leaveDescription'),
        confirmLabel: t('settings.editor.leave'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }))
    )
      return;
    dirty.current = false;
    setNotice(null);
    if (next === null) onSelect(id);
    else if (nextLevel === null) onSelect(id, next);
    else onSelect(id, next, nextLevel);
  };
  const onDirty = useCallback(
    (value: boolean) => {
      dirty.current = value;
    },
    [dirty],
  );
  return { go, notice, setNotice, lastOpen, onDirty };
}

export type PipelineNavigation = ReturnType<typeof usePipelineNavigation>;
