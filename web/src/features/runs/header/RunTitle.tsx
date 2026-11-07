import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { runTitle, taskNumber } from '../../../shared/lib/format.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';

/** Same limit as the daemon's run title. */
const TITLE_LIMIT = 60;

/** The state of editing the title in place: the draft, the saving and the focus that comes back. */
function useTitleEdit(run: RunView, api: Api) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Whether the field is open and the text in it: read by handlers that may run with stale props
  // (the browser fires blur on the removed input after it has been closed).
  const editing = useRef(false);
  const text = useRef('');
  const failed = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  const current = runTitle(run);

  useEffect(() => {
    if (draft === null && restoreFocus.current) {
      restoreFocus.current = false;
      heading.current?.querySelector('button')?.focus();
    }
  }, [draft]);

  const open = () => {
    editing.current = true;
    text.current = current;
    failed.current = null;
    setDraft(current);
  };
  const close = (refocus: boolean) => {
    editing.current = false;
    busy.current = false;
    failed.current = null;
    restoreFocus.current = refocus;
    setDraft(null);
    setError(null);
  };
  const save = async (fromBlur = false) => {
    if (!editing.current || busy.current) return;
    const title = text.current.trim();
    if (fromBlur && title === failed.current) return;
    if (title === '' || title === current) {
      close(!fromBlur);
      return;
    }
    busy.current = true;
    setError(null);
    try {
      await api.setRunTitle(run.id, title);
      close(!fromBlur);
    } catch (failure) {
      busy.current = false;
      failed.current = title;
      setError((failure as Error).message);
    }
  };
  return { draft, setDraft, error, text, heading, current, open, close, save };
}

/** The heading of a run; the pencil that appears on hover or focus edits the title in place. */
export function RunTitle({ run, api }: { run: RunView; api: Api }) {
  const { t } = useTranslation();
  const { draft, setDraft, error, text, heading, current, open, close, save } = useTitleEdit(
    run,
    api,
  );

  if (draft === null) {
    return (
      <h1
        ref={heading}
        className="group flex min-w-0 flex-1 items-start gap-1 text-lg font-semibold break-words [overflow-wrap:anywhere]"
      >
        <span className="min-w-0">
          <span className="font-mono text-base font-normal text-muted-foreground">
            {taskNumber(run.number)}
          </span>{' '}
          <span title={`${current}\n${run.id}`}>{current}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t('runs.header.editTitle')}
          title={t('runs.header.editTitle')}
          onClick={open}
        >
          <Pencil />
        </Button>
      </h1>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-base text-muted-foreground">{taskNumber(run.number)}</span>
        <Input
          autoFocus
          value={draft}
          maxLength={TITLE_LIMIT}
          aria-label={t('runs.header.titleLabel')}
          aria-invalid={error !== null}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            text.current = event.target.value;
            setDraft(event.target.value);
          }}
          onBlur={() => void save(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
          }}
        />
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
