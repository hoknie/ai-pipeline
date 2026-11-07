import { Trans, useTranslation } from 'react-i18next';

import type {
  ConfigEditorResponse,
  EntryReference,
  FieldError,
} from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { FILE_PATH_CLASS } from '../../../shared/ui/layout/FilePath.tsx';
import { describeReference } from '../../specialists/index.ts';

/** What the last write and the preview said: a notice, a problem, a conflict, errors, users. */
export function PipelineNotices({
  view,
  notice,
  problem,
  conflict,
  otherErrors,
  references,
  onReread,
}: {
  view: ConfigEditorResponse;
  notice: string | null;
  problem: string | null;
  conflict: string | null;
  otherErrors: FieldError[];
  references: EntryReference[];
  onReread: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {notice ? <Alert role="status">{notice}</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-2">
          <p>{t('settings.editor.conflict', { message: conflict })}</p>
          <Button variant="outline" size="sm" onClick={onReread}>
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
    </>
  );
}

/** Where the file of the level stands among the levels. */
export function LevelHint({
  global,
  sharedOnly,
  projectFile,
  globalFile,
}: {
  /** The form shows the shared level. */
  global: boolean;
  sharedOnly: boolean;
  projectFile: boolean;
  globalFile: string | null;
}) {
  const { t } = useTranslation();
  if (global && !sharedOnly) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('settings.editor.globalHint')}
        {projectFile ? t('settings.editor.globalOverridden') : ''}
      </p>
    );
  }
  if (globalFile === null) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <Trans
        i18nKey="settings.editor.projectOverrides"
        values={{ file: globalFile }}
        components={{ code: <code className={FILE_PATH_CLASS} title={globalFile} /> }}
      />
    </p>
  );
}
