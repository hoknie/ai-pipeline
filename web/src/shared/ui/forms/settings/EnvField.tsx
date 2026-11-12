import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../button.tsx';
import { Input } from '../input.tsx';

import { ENV_NAME } from './settingFields.ts';

/** What the draft does to a variable. */
function envState(
  draft: string | null | undefined,
  isNew: boolean,
): 'willDelete' | 'willAdd' | 'willReplace' | 'hidden' {
  if (draft === null) return 'willDelete';
  if (isNew) return 'willAdd';
  return draft !== undefined ? 'willReplace' : 'hidden';
}

function EnvRow({
  variable,
  draft,
  isNew,
  disabled,
  onSet,
  onUndo,
}: {
  variable: string;
  draft: string | null | undefined;
  isNew: boolean;
  disabled: boolean;
  onSet: (name: string, value: string | null) => void;
  onUndo: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [replacing, setReplacing] = useState(false);
  const deleted = draft === null;
  const state = envState(draft, isNew);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <code className={deleted ? 'line-through' : undefined}>{variable}</code>
      <span className="text-xs text-muted-foreground">{t(`settingsPage.env.${state}`)}</span>
      {replacing && !deleted ? (
        <Input
          type="password"
          autoComplete="off"
          className="h-7 w-48"
          aria-label={t('settingsPage.env.newValueOf', { name: variable })}
          value={draft ?? ''}
          onChange={(event) =>
            event.target.value === '' && !isNew
              ? onUndo(variable)
              : onSet(variable, event.target.value)
          }
        />
      ) : null}
      {!deleted && !isNew && !replacing ? (
        <Button
          aria-label={`${t('settingsPage.env.replace')} ${variable}`}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setReplacing(true)}
        >
          {t('settingsPage.env.replace')}
        </Button>
      ) : null}
      {!deleted ? (
        <Button
          aria-label={`${t('settingsPage.env.delete')} ${variable}`}
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            if (isNew) onUndo(variable);
            else onSet(variable, null);
            setReplacing(false);
          }}
        >
          {t('settingsPage.env.delete')}
        </Button>
      ) : (
        <Button
          aria-label={`${t('settingsPage.env.undo')} ${variable}`}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onUndo(variable)}
        >
          {t('settingsPage.env.undo')}
        </Button>
      )}
    </li>
  );
}

function NewVariable({
  runtime,
  disabled,
  nameProblem,
  name,
  value,
  nameRef,
  onName,
  onValue,
  onAdd,
}: {
  runtime: string;
  disabled: boolean;
  nameProblem: string | null;
  name: string;
  value: string;
  nameRef: RefObject<HTMLInputElement | null>;
  onName: (name: string) => void;
  onValue: (value: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const canAdd = !disabled && name !== '' && nameProblem === null;
  // Enter adds the variable; it never sends the whole form.
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (canAdd) onAdd();
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <span aria-hidden className="text-xs text-muted-foreground">
          {t('settingsPage.env.nameLabel')}
        </span>
        <Input
          ref={nameRef}
          className="w-40"
          aria-label={t('settingsPage.env.name', { runtime })}
          placeholder="NAME"
          value={name}
          disabled={disabled}
          aria-invalid={nameProblem !== null}
          onChange={(event) => onName(event.target.value)}
          onKeyDown={onEnter}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span aria-hidden className="text-xs text-muted-foreground">
          {t('settingsPage.env.valueLabel')}
        </span>
        <Input
          type="password"
          autoComplete="off"
          className="w-48"
          aria-label={t('settingsPage.env.value', { runtime })}
          value={value}
          disabled={disabled}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={onEnter}
        />
      </div>
      <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={onAdd}>
        {t('settingsPage.env.add')}
      </Button>
    </div>
  );
}

/**
 * The row for a new variable. A valid free name is a draft of its own at once, so «Save» keeps
 * a pair that was typed but not added; renaming drops the old draft. `added` are the names of
 * the drafts of new variables, `names` the saved ones.
 */
function useNewVariableRow({
  names,
  drafts,
  onSet,
  onUndo,
}: {
  names: string[];
  drafts: Record<string, string | null>;
  onSet: (name: string, value: string | null) => void;
  onUndo: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  // The name of the variable the row has already put into the draft while it is being typed.
  const [typing, setTyping] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const added = Object.keys(drafts).filter((candidate) => !names.includes(candidate));
  const listed = added.filter((candidate) => candidate !== typing);
  const all = [...names, ...listed];
  const problemOf = (candidate: string): 'invalid' | 'taken' | null =>
    candidate === ''
      ? null
      : !ENV_NAME.test(candidate)
        ? 'invalid'
        : all.includes(candidate)
          ? 'taken'
          : null;
  const nameProblem = problemOf(name);

  // «Discard» or a write took the draft of the row away: the row starts empty again.
  useEffect(() => {
    if (typing !== null && !(typing in drafts)) {
      setTyping(null);
      setName('');
      setValue('');
    }
  }, [drafts, typing]);

  const changeName = (next: string) => {
    if (typing !== null && typing !== next) onUndo(typing);
    setName(next);
    if (problemOf(next) === null && next !== '') {
      onSet(next, value);
      setTyping(next);
    } else setTyping(null);
  };
  const changeValue = (next: string) => {
    setValue(next);
    if (typing !== null) onSet(typing, next);
  };
  const add = () => {
    // the draft is already there: the variable moves from the row to the list
    setTyping(null);
    setName('');
    setValue('');
    nameRef.current?.focus();
  };

  return { name, value, nameRef, nameProblem, all, changeName, changeValue, add };
}

/**
 * The environment variables of a runtime. Only the names are known to the panel: a value can be
 * set or replaced, never read. `drafts` maps a name to the new value, or to null for a deletion.
 */
export function EnvField({
  runtime,
  names,
  drafts,
  error,
  disabled,
  onSet,
  onUndo,
}: {
  runtime: string;
  names: string[];
  drafts: Record<string, string | null>;
  error: string | null;
  disabled: boolean;
  onSet: (name: string, value: string | null) => void;
  onUndo: (name: string) => void;
}) {
  const { t } = useTranslation();
  const { name, value, nameRef, nameProblem, all, changeName, changeValue, add } =
    useNewVariableRow({ names, drafts, onSet, onUndo });

  return (
    <div
      role="group"
      aria-label={t('settingsPage.env.label', { runtime })}
      className="flex flex-col gap-2"
    >
      {all.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('settingsPage.env.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {all.map((variable) => (
            <EnvRow
              key={variable}
              variable={variable}
              draft={drafts[variable]}
              isNew={!names.includes(variable)}
              disabled={disabled}
              onSet={onSet}
              onUndo={onUndo}
            />
          ))}
        </ul>
      )}
      <NewVariable
        runtime={runtime}
        disabled={disabled}
        nameProblem={nameProblem}
        name={name}
        value={value}
        nameRef={nameRef}
        onName={changeName}
        onValue={changeValue}
        onAdd={add}
      />
      <p className="text-xs text-muted-foreground">{t('settingsPage.env.multiple')}</p>
      {nameProblem ? (
        <p className="text-xs text-destructive">{t(`settingsPage.env.${nameProblem}`)}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
