import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { EditorChain, FieldError } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { ConfigErrors } from '../../../shared/ui/layout/EntryList.tsx';
import { ScopeContext } from '../../providers/index.ts';
import { LevelHint } from '../form/SpecialistNotices.tsx';
import { ChainFields } from './ChainFields.tsx';
import { ChainHeader } from './ChainHeader.tsx';
import { ChainRuntimes, ITEM_FIELD_ERROR } from './ChainRuntimes.tsx';
import { useChainEditor } from './useChainEditor.ts';

export interface ChainFormProps {
  api: Api;
  chain: EditorChain | null;
  scope?: 'global' | null;
  onDirty: (dirty: boolean) => void;
  onSaved: (slug: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

function ChainNotices({
  problem,
  conflict,
  references,
  errors,
}: {
  problem: string | null;
  conflict: string | null;
  references: string[];
  errors: FieldError[];
}) {
  const { t } = useTranslation();
  // The errors of provider and default are shown at the fields of the item.
  const general = errors.filter((error) => !ITEM_FIELD_ERROR.test(error.path));
  return (
    <>
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {conflict ? <Alert variant="destructive">{conflict}</Alert> : null}
      {references.length > 0 ? (
        <Alert variant="destructive">
          {t('chains.referencedNotice', { refs: references.join(', ') })}
        </Alert>
      ) : null}
      {general.length > 0 ? <ConfigErrors errors={general} /> : null}
    </>
  );
}

export function ChainForm({ api, chain, scope, onDirty, onSaved, onDeleted }: ChainFormProps) {
  const { t } = useTranslation();
  const editor = useChainEditor({ api, chain, scope, onDirty, onSaved, onDeleted });
  const { draft, setDraft, busy, readOnly } = editor;
  const disabled = busy || readOnly;

  return (
    <ScopeContext.Provider value={scope === 'global' ? 'global' : 'project'}>
      <section
        className="flex flex-col gap-3"
        aria-label={t('chains.section', { id: draft.slug || t('chains.new') })}
      >
        <ChainHeader chain={chain} scope={scope} editor={editor} />
        {readOnly ? <Alert role="status">{t('chains.sharedReadOnly')}</Alert> : null}
        <ChainNotices
          problem={editor.problem}
          conflict={editor.conflict}
          references={editor.references}
          errors={editor.errors}
        />
        <LevelHint
          level={readOnly ? 'global' : editor.level}
          projectFile={Boolean(chain?.sources.project)}
          globalFile={chain?.sources.global?.file ?? null}
        />
        <div className="@container">
          <div className="grid gap-3 @3xl:grid-cols-2">
            <ChainFields
              isNew={chain === null}
              disabled={disabled}
              draft={draft}
              onChange={setDraft}
            />
            <ChainRuntimes api={api} editor={editor} disabled={disabled} />
          </div>
        </div>
      </section>
    </ScopeContext.Provider>
  );
}
