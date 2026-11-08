import { useTranslation } from 'react-i18next';

import type { EditorChain } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import type { useChainEditor } from './useChainEditor.ts';

type Editor = ReturnType<typeof useChainEditor>;

function ChainActions({ chain, editor }: { chain: EditorChain | null; editor: Editor }) {
  const { t } = useTranslation();
  const { readOnly, busy, dirty, draft, canOverride } = editor;
  return (
    <div className="flex flex-wrap gap-2">
      {!readOnly ? (
        <Button disabled={busy || !draft.slug.trim()} onClick={() => void editor.save()}>
          {t('settings.editor.save')}
        </Button>
      ) : null}
      {canOverride ? (
        <Button variant="outline" disabled={busy} onClick={() => void editor.override()}>
          {t('settings.editor.overrideInProject')}
        </Button>
      ) : null}
      {dirty ? (
        <Button variant="outline" disabled={busy} onClick={editor.reset}>
          {t('settingsPage.discard')}
        </Button>
      ) : null}
      {chain && !readOnly ? (
        <Button variant="destructive" disabled={busy} onClick={() => void editor.remove()}>
          {editor.removeLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ChainHeader({
  chain,
  scope,
  editor,
}: {
  chain: EditorChain | null;
  scope?: 'global' | null;
  editor: Editor;
}) {
  const { t } = useTranslation();
  const { level } = editor;
  const file = chain?.sources[level]?.file ?? chain?.file;
  return (
    <header
      role="toolbar"
      aria-label={t('chains.header')}
      data-sticky
      className="sticky -top-4 z-10 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-background px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{chain ? chain.slug : t('chains.new')}</h2>
        <Badge variant="outline">
          {t(`settings.editor.levels.${scope ? level : (chain?.level ?? level)}`)}
        </Badge>
      </div>
      {file ? <FilePath variant="line" path={file} /> : null}
      <ChainActions chain={chain} editor={editor} />
    </header>
  );
}
