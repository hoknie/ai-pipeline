import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationSenderView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';

/** The ids of a value of the parameter: separated by commas, no blanks. */
export function userIds(value: string): string[] {
  return value
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}

/**
 * The ids after adding the ones of a text (separated by blanks or commas); null when one does not fit
 * the pattern or the value would be too long. An id that is there already is not added twice.
 */
function withIds(
  chips: string[],
  raw: string,
  pattern: string | undefined,
  maxLength: number,
): string[] | null {
  const given = [...new Set(raw.split(/[\s,]+/u).filter((one) => one !== ''))];
  const fits = given.every(
    (one) => pattern === undefined || new RegExp(`^(?:${pattern})$`, 'u').test(one),
  );
  const next = [...chips, ...given.filter((one) => !chips.includes(one))];
  return fits && next.join(',').length <= maxLength ? next : null;
}

type Loaded = IntegrationSenderView[] | null;

function Chips({ chips, onRemove }: { chips: string[]; onRemove: (user: string) => void }) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {chips.map((one) => (
        <li
          key={one}
          className="flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-sm"
        >
          <code>{one}</code>
          <button
            type="button"
            aria-label={t('integrations.users.remove', { user: one })}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(one)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The people who wrote lately: a name is only text, a press adds the id as a chip. */
function Suggestions({
  kind,
  list,
  chips,
  onAdd,
  onRefresh,
}: {
  kind: string;
  list: IntegrationSenderView[];
  chips: string[];
  onAdd: (user: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const offered = list.filter((one) => !chips.includes(one.user));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t('integrations.users.suggestions')}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          {t('integrations.users.refresh')}
        </Button>
      </div>
      {offered.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1">
          {offered.map((one) => (
            <li key={one.user}>
              <Button type="button" variant="outline" size="sm" onClick={() => onAdd(one.user)}>
                {one.label === null ? one.user : `${one.label} · ${one.user}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            kind === 'slack' ? 'integrations.users.emptySlack' : 'integrations.users.emptyTelegram',
          )}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The list of users of a chat connection as chips: an id is added by Enter, a comma, a space, the
 * loss of focus or a paste, and must fit the pattern of the parameter. The people who wrote to the
 * chat lately are offered under the field.
 */
export function UserListField({
  id,
  kind,
  pattern,
  maxLength,
  value,
  onChange,
  describedBy,
  loadSenders,
}: {
  id: string;
  kind: string;
  pattern: string | undefined;
  maxLength: number;
  value: string;
  onChange: (value: string) => void;
  describedBy: string | undefined;
  /** Reads the recent senders; absent where the connection does not exist yet. */
  loadSenders?: () => Promise<IntegrationSenderView[]>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const chips = userIds(value);

  const add = (raw: string) => {
    const next = withIds(chips, raw, pattern, maxLength);
    setInvalid(next === null);
    if (next === null) return;
    setText('');
    if (next.length > chips.length) onChange(next.join(','));
  };

  const load = () => {
    void loadSenders?.().then(setLoaded, () => setLoaded([]));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      event.preventDefault();
      add(text);
    } else if (event.key === 'Backspace' && text === '' && chips.length > 0) {
      onChange(chips.slice(0, -1).join(','));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[\s,]/u.test(pasted.trim())) return;
    event.preventDefault();
    add(`${text} ${pasted}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <Chips
        chips={chips}
        onRemove={(one) => onChange(chips.filter((other) => other !== one).join(','))}
      />
      <Input
        id={id}
        value={text}
        placeholder={t('integrations.users.add')}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => loaded === null && load()}
        onBlur={() => add(text)}
      />
      {invalid ? (
        <p role="alert" className="text-xs text-status-err">
          {t('integrations.users.invalid')}
        </p>
      ) : null}
      {loaded === null ? null : (
        <Suggestions kind={kind} list={loaded} chips={chips} onAdd={add} onRefresh={load} />
      )}
    </div>
  );
}
