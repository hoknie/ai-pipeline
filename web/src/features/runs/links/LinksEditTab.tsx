import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { LinksEditor, type LinkRow } from './LinksEditor.tsx';
import type { LinkKind } from './linkKinds.ts';
import type { LinkTargetGroup } from './linkTargets.ts';

const EDITABLE: readonly LinkKind[] = ['parent', 'related', 'duplicates'];
/** A run put back in the queue waits again, so its «blocked by» links can change. */
const EDITABLE_RETURNED: readonly LinkKind[] = ['blocked_by', ...EDITABLE];

const rowsOf = (run: RunView): LinkRow[] =>
  run.links.map((link) => ({ kind: link.kind, target: link.id }));

const same = (a: LinkRow, b: LinkRow) => a.kind === b.kind && a.target === b.target;

/** The «Edit» tab of the links section: the rows are applied with one «Save», removals first. */
export function LinksEditTab({
  run,
  api,
  choices,
}: {
  run: RunView;
  api: Api;
  choices: (kind: LinkKind) => LinkTargetGroup[];
}) {
  const { t } = useTranslation();
  const original = rowsOf(run);
  const signature = JSON.stringify(original);
  const [draft, setDraft] = useState<{ from: string; rows: LinkRow[] }>({
    from: signature,
    rows: original,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the run changed under the editor (an event or a saved edit): start from its links again
  const rows = draft.from === signature ? draft.rows : original;
  const dirty = rows.length !== original.length || rows.some((row, i) => !same(row, original[i]!));
  const complete = rows.every((row) => row.target !== '');
  const save = async () => {
    if (busy || !dirty || !complete) return;
    setBusy(true);
    setError(null);
    try {
      for (const old of original) {
        if (!rows.some((row) => same(row, old))) await api.taskUnlink(run.id, old.kind, old.target);
      }
      for (const row of rows) {
        if (!original.some((old) => same(row, old)))
          await api.taskLink(run.id, row.kind, row.target);
      }
    } catch (failure) {
      // part of the changes may be applied: the run changes, keep the draft of the user
      setDraft({ from: signature, rows });
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-links-edit="">
      <LinksEditor
        value={rows}
        onChange={(next) => setDraft({ from: signature, rows: next })}
        choices={choices}
        editableKinds={
          run.state === 'queued' && run.queueItem !== null ? EDITABLE_RETURNED : EDITABLE
        }
        disabled={busy}
      />
      {run.state === 'queued' && run.queueItem !== null ? null : (
        <p className="text-xs text-muted-foreground">{t('links.startedHint')}</p>
      )}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !dirty || !complete} onClick={() => void save()}>
          {t('links.save')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !dirty}
          onClick={() => setDraft({ from: signature, rows: original })}
        >
          {t('links.reset')}
        </Button>
      </div>
    </div>
  );
}
