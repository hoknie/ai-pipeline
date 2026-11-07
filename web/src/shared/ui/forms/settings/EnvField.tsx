import { useState } from 'react';
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
  onName,
  onValue,
  onAdd,
}: {
  runtime: string;
  disabled: boolean;
  nameProblem: string | null;
  name: string;
  value: string;
  onName: (name: string) => void;
  onValue: (value: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-40"
        aria-label={t('settingsPage.env.name', { runtime })}
        placeholder="NAME"
        value={name}
        disabled={disabled}
        aria-invalid={nameProblem !== null}
        onChange={(event) => onName(event.target.value)}
      />
      <Input
        type="password"
        autoComplete="off"
        className="w-48"
        aria-label={t('settingsPage.env.value', { runtime })}
        value={value}
        disabled={disabled}
        onChange={(event) => onValue(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || name === '' || nameProblem !== null}
        onClick={onAdd}
      >
        {t('settingsPage.env.add', { runtime })}
      </Button>
    </div>
  );
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
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const added = Object.keys(drafts).filter((candidate) => !names.includes(candidate));
  const all = [...names, ...added];
  const nameProblem =
    name === '' ? null : !ENV_NAME.test(name) ? 'invalid' : all.includes(name) ? 'taken' : null;

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
        onName={setName}
        onValue={setValue}
        onAdd={() => {
          onSet(name, value);
          setName('');
          setValue('');
        }}
      />
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
