import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorView } from 'prosemirror-view';
import { linkTransaction, selectedLink } from '../../../lib/markdown/linkEditing.ts';
import { Button } from '../button.tsx';
import { Input } from '../input.tsx';

export function LinkEditor({ view, close }: { view: EditorView; close: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => selectedLink(view.state));
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  function finish(remove = false) {
    if (view.isDestroyed) return close();
    const transaction = linkTransaction(view.state, draft, remove);
    if (!transaction) return setError(true);
    view.dispatch(transaction);
    close();
    view.focus();
  }
  function cancel() {
    close();
    if (!view.isDestroyed) view.focus();
  }
  return (
    <div
      role="dialog"
      aria-label={t('queue.form.linkEditor.title')}
      className="flex flex-wrap gap-2 rounded-md border p-2"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <Input
        aria-label={t('queue.form.linkEditor.text')}
        value={draft.text}
        onChange={(event) => setDraft({ ...draft, text: event.target.value })}
      />
      <Input
        ref={input}
        aria-label={t('queue.form.linkEditor.destination')}
        value={draft.href}
        onChange={(event) => setDraft({ ...draft, href: event.target.value })}
        aria-invalid={error}
      />
      {error && <p role="alert">{t('queue.form.linkEditor.invalid')}</p>}
      <Button type="button" onClick={() => finish()}>
        {t('queue.form.linkEditor.apply')}
      </Button>
      <Button type="button" variant="outline" onClick={() => finish(true)}>
        {t('queue.form.linkEditor.remove')}
      </Button>
      <Button type="button" variant="outline" onClick={cancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}
