import { useTranslation } from 'react-i18next';

import type { ConfigEditorResponse } from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../shared/ui/forms/toggle-group.tsx';
import { ActionFields } from './action/ActionFields.tsx';
import { ActionHeader } from './action/ActionHeader.tsx';
import { describeActionReference, type ActionDraft, type Field } from './action/actionDraft.ts';
import { useActionEditor, type ActionEditorInput } from './action/useActionEditor.ts';

export {
  describeActionReference,
  draftOfAction,
  valueOfAction,
  type ActionDraft,
} from './action/actionDraft.ts';

type Editor = ReturnType<typeof useActionEditor>;

/** What the last write said: a problem, a conflict, errors, the places that name the action. */
function ActionNotices({
  editor,
  view,
  notice,
}: {
  editor: Editor;
  view: ConfigEditorResponse;
  notice: string | null;
}) {
  const { t } = useTranslation();
  const { problem, conflict, otherErrors, references } = editor;
  return (
    <>
      {notice ? <Alert role="status">{notice}</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? (
        <Alert variant="destructive" className="flex flex-col items-start gap-2">
          <p>{t('settings.editor.conflict', { message: conflict })}</p>
          <Button variant="outline" size="sm" onClick={() => void editor.reread()}>
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
    </>
  );
}

export function ActionForm(props: ActionEditorInput & { notice: string | null }) {
  const { view, action, notice } = props;
  const { t } = useTranslation();
  const editor = useActionEditor(props);
  const { level, draft, busy } = editor;
  const update = (patch: Partial<ActionDraft>) =>
    editor.setDraft((current) => ({ ...current, ...patch }));
  const errorsOf = (field: Field) =>
    editor.fieldErrors(field).map((error) => (
      <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
        {error.message}
      </p>
    ));
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('pipeline.actions.section', {
        id: editor.id || t('pipeline.actions.newName'),
      })}
    >
      <ActionHeader action={action} editor={editor} />
      <ActionNotices editor={editor} view={view} notice={notice} />
      <ToggleGroup
        type="single"
        value={level}
        aria-label={t('settings.editor.level')}
        onValueChange={(next) => {
          if (next) void editor.switchLevel(next as 'project' | 'global');
        }}
      >
        <ToggleGroupItem value="project">{t('settings.editor.project')}</ToggleGroupItem>
        <ToggleGroupItem value="global">{t('settings.editor.global')}</ToggleGroupItem>
      </ToggleGroup>
      <p className="text-sm text-muted-foreground">
        {level === 'global' ? t('settings.editor.globalHint') : t('pipeline.actions.projectHint')}
      </p>
      <div className="@container">
        <div className="grid items-start gap-3 @3xl:grid-cols-2">
          <ActionFields
            draft={draft}
            disabled={busy}
            update={update}
            errorsOf={errorsOf}
            options={editor.options}
            newId={action ? null : editor.newId}
            onNewId={editor.setNewId}
          />
        </div>
      </div>
    </section>
  );
}
