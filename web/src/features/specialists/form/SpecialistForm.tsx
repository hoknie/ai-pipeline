import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  ConfigCatalogResponse,
  ConfigEditorResponse,
  EditorSpecialist,
} from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { useEditorActions } from './useSpecialistEditor.ts';
import { valueOf } from './draft.ts';
import { SpecialistFields } from './SpecialistFields.tsx';
import { LevelHint, SpecialistNotices } from './SpecialistNotices.tsx';
import { SpecialistHeader, type HeaderProps } from './SpecialistHeader.tsx';
import { SpecialistTagsInput } from './SpecialistTagsInput.tsx';
import { UsageBlock, describeReference, type SharedOnly } from './SpecialistUsage.tsx';

export { valueOf, describeReference };
export type { SharedOnly };

interface SpecialistFormProps {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new specialist. */
  specialist: EditorSpecialist | null;
  /** Tools and skills to choose from; null while it is not loaded or failed to load. */
  catalog: ConfigCatalogResponse | null;
  catalogError: string | null;
  notice: string | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (slug: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  /** Edits a shared specialist at the shared level only, with the usage by the projects. */
  sharedOnly?: SharedOnly;
}

/** The field for the slug of a new specialist. */
function SlugField({
  slug,
  busy,
  onChange,
}: {
  slug: string;
  busy: boolean;
  onChange: (slug: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="field-slug">Slug</Label>
      <Input
        id="field-slug"
        type="text"
        value={slug}
        disabled={busy}
        placeholder="coder"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

type Editor = ReturnType<typeof useEditorActions>;

/** What the sticky bar shows and which buttons it offers. */
function headerOf(
  editor: Editor,
  specialist: EditorSpecialist | null,
  sharedOnly: SharedOnly | undefined,
): HeaderProps {
  const { sources, source, readOnly } = editor;
  const copyOnly = specialist !== null && !sharedOnly;
  return {
    specialist,
    level: editor.level,
    file: specialist ? (source?.file ?? specialist.file) : undefined,
    levelChoice: !sharedOnly && (!specialist || editor.bothLevels),
    readOnly,
    busy: editor.busy,
    canSave: Boolean(specialist) || editor.slug !== '',
    overrideInProject: copyOnly && Boolean(sources.global) && !sources.project,
    makeGlobal: copyOnly && Boolean(sources.project) && !sources.global && !readOnly,
    canRemove: Boolean(specialist && source) && !readOnly,
    removeBlocked: editor.removeBlocked,
    removeBlockedReason: editor.removeBlockedReason,
    removeLabel: editor.removeLabel,
    onLevel: (next) => (specialist ? void editor.switchLevel(next) : editor.setLevel(next)),
    onSave: () => void editor.save(),
    onCopyTo: (target) => void editor.copyTo(target),
    onSaveAs: () => editor.setSaveAs(editor.saveAs === null ? '' : null),
    onRemove: () => void editor.remove(),
  };
}

/** The slug of the copy and the button that creates it. */
function SaveAsRow({
  slug,
  disabled,
  onChange,
  onCreate,
}: {
  slug: string;
  disabled: boolean;
  onChange: (slug: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="field-save-as">{t('specialists.newSlug')}</Label>
      <div className="flex gap-2">
        <Input
          id="field-save-as"
          type="text"
          value={slug}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button variant="outline" disabled={disabled || slug === ''} onClick={onCreate}>
          {t('settings.editor.createCopy')}
        </Button>
      </div>
    </div>
  );
}

export function SpecialistForm(props: SpecialistFormProps) {
  const { view, specialist, catalog, catalogError, notice, sharedOnly } = props;
  const { t } = useTranslation();
  const editor = useEditorActions(props);
  const { level, draft, slug, saveAs, busy, sources, readOnly } = editor;
  const tags = (
    <SpecialistTagsInput
      view={view}
      specialist={specialist}
      level={level}
      draft={draft}
      setDraft={editor.setDraft}
      disabled={readOnly || busy}
      invalid={editor.fieldErrors('tags').length > 0}
    />
  );
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('specialists.section', { id: editor.id || t('specialists.newName') })}
    >
      <SpecialistHeader {...headerOf(editor, specialist, sharedOnly)} />
      {saveAs !== null ? (
        <SaveAsRow
          slug={saveAs}
          disabled={busy}
          onChange={editor.setSaveAs}
          onCreate={() => void editor.saveCopy()}
        />
      ) : null}
      {editor.removeBlocked && specialist ? (
        <p className="text-sm text-muted-foreground" data-testid="delete-blocked">
          {editor.removeBlockedReason}
        </p>
      ) : null}
      {readOnly ? <Alert role="status">{t('specialists.sharedReadOnly')}</Alert> : null}
      <SpecialistNotices
        view={view}
        notice={notice}
        problem={editor.problem}
        conflict={editor.conflict}
        otherErrors={editor.otherErrors}
        references={editor.references}
        onReread={() => void editor.reread()}
      />
      <LevelHint
        level={level}
        projectFile={Boolean(sources.project)}
        globalFile={sources.global?.file ?? null}
      />
      {sharedOnly && specialist ? <UsageBlock shared={sharedOnly} view={view} /> : null}
      <SpecialistFields
        draft={draft}
        onDraft={editor.setDraft}
        disabled={readOnly || busy}
        errors={editor.errors}
        prefix={editor.prefix}
        defaults={editor.defaults}
        catalog={catalog}
        catalogError={catalogError}
        chains={view.chains}
        mcpServers={view.mcpServers}
        tags={tags}
        tagsHelp={level === 'global' ? t('specialists.tags.sharedOnly') : undefined}
        mainStart={
          !specialist ? <SlugField slug={slug} busy={busy} onChange={editor.setSlug} /> : null
        }
      />
    </section>
  );
}
