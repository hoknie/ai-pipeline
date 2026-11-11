import { useTranslation } from 'react-i18next';

import type { ActionEntry } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import type { useActionEditor } from './useActionEditor.ts';

type Editor = ReturnType<typeof useActionEditor>;

/** The sticky head of the form: the name, the level, the file and the buttons. */
export function ActionHeader({ action, editor }: { action: ActionEntry | null; editor: Editor }) {
  const { t } = useTranslation();
  const { level, busy, dirty, source } = editor;
  const title = action
    ? typeof action.raw.name === 'string' && action.raw.name !== ''
      ? action.raw.name
      : action.id
    : t('pipeline.actions.new');
  const file = source?.file ?? action?.file;
  return (
    <header
      role="toolbar"
      aria-label={t('pipeline.actions.header')}
      data-sticky
      className="sticky -top-4 z-10 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-background px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Badge variant="outline">{t(`settings.editor.levels.${level}`)}</Badge>
      </div>
      {file ? <FilePath variant="line" path={file} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || (!action && !editor.newId)} onClick={() => void editor.save()}>
          {t('settings.editor.save')}
        </Button>
        {dirty ? (
          <Button variant="outline" disabled={busy} onClick={editor.reset}>
            {t('settingsPage.discard')}
          </Button>
        ) : null}
        {action && source ? (
          <Button variant="destructive" disabled={busy} onClick={() => void editor.remove()}>
            {t('settings.editor.remove')}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
