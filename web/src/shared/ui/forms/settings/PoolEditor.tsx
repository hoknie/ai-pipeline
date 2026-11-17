import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../button.tsx';
import { Input } from '../input.tsx';
import { ValuesPicker, type PickerOption } from '../ValuesPicker.tsx';
import { memberProblem, POOL_MAX_RANGE, type PoolDraft, type PoolProblem } from './poolsDraft.ts';

export type PoolField = 'name' | 'max' | 'members';
export type Touched = Partial<Record<PoolField, boolean>>;

const FIELD_OF: Partial<Record<PoolProblem, PoolField>> = {
  emptyName: 'name',
  duplicateName: 'name',
  max: 'max',
  noMembers: 'members',
};

const SUGGESTIONS: PickerOption[] = [
  'claude',
  'agy',
  'opencode',
  'codex',
  'kilo',
  'cline',
  'copilot',
].map((name) => ({
  name,
  source: 'builtin',
}));

export function Messages({ messages }: { messages: string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p key={message} role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </>
  );
}

function Hint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

/**
 * The selectors of one pool as chips. A selector with a wrong format, a repeat or an overlap with
 * another pool is refused before it is added; messages of the daemon and of the file sit at the chip.
 */
function Members({
  pools,
  index,
  errors,
  invalid,
  disabled,
  onChange,
}: {
  pools: readonly PoolDraft[];
  index: number;
  errors: Map<number, string[]>;
  invalid: boolean;
  disabled: boolean;
  onChange: (members: string[]) => void;
}) {
  const { t } = useTranslation();
  const members = pools[index]?.members ?? [];
  const validate = (value: string): string | null => {
    const found = memberProblem(pools, index, value);
    if (found === null) return null;
    if (found.problem === 'overlap') {
      return t('settingsPage.pools.refuse.overlap', { pool: found.pool, selector: found.with });
    }
    return t(`settingsPage.pools.problem.${found.problem}`);
  };
  return (
    <ValuesPicker
      id={`pool-${index}-selectors`}
      label={t('settingsPage.pools.selectors')}
      values={members}
      options={SUGGESTIONS}
      headings={{ builtin: '' }}
      creatable
      disabled={disabled}
      invalid={invalid || errors.size > 0}
      validate={validate}
      mark={(value) => errors.get(members.indexOf(value))?.join(' ') ?? null}
      onChange={onChange}
    />
  );
}

/** A labelled input of the pool with its hint, replaced by the problems when there are any. */
function PoolInput({
  id,
  label,
  hint,
  messages,
  className,
  ...input
}: {
  id: string;
  label: string;
  hint: string;
  messages: string[];
  className: string;
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'className'>) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} aria-invalid={messages.length > 0} {...input} />
      <Messages messages={messages} />
      {messages.length === 0 ? <Hint text={hint} /> : null}
    </div>
  );
}

function RemovePool({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="mt-6 size-9.5 shrink-0"
      disabled={disabled}
      aria-label={t('settingsPage.pools.remove')}
      title={t('settingsPage.pools.remove')}
      onClick={onRemove}
    >
      <Trash2 />
    </Button>
  );
}

function SelectorsField({
  pools,
  index,
  messages,
  disabled,
  onChange,
}: {
  pools: readonly PoolDraft[];
  index: number;
  messages: { members: string[]; byMember: Map<number, string[]> };
  disabled: boolean;
  onChange: (members: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{t('settingsPage.pools.selectors')}</span>
      <Members
        pools={pools}
        index={index}
        errors={messages.byMember}
        invalid={messages.members.length > 0}
        disabled={disabled}
        onChange={onChange}
      />
      <Messages messages={messages.members} />
      {messages.members.length === 0 ? <Hint text={t('settingsPage.pools.selectorsHint')} /> : null}
    </div>
  );
}

/** The messages of a pool by field; problems of a field wait until it is touched or «save» fails. */
function useMessages(
  problems: { member: number | null; problem: PoolProblem }[],
  errors: { member: number | null; message: string }[],
  touched: Touched,
  showAll: boolean,
) {
  const { t } = useTranslation();
  const text = (problem: PoolProblem) => t(`settingsPage.pools.problem.${problem}`);
  const ofField = (field: PoolField) =>
    problems
      .filter((entry) => entry.member === null && FIELD_OF[entry.problem] === field)
      .filter(() => showAll || touched[field] === true)
      .map((entry) => text(entry.problem));
  const byMember = new Map<number, string[]>();
  const memberMessages = [
    ...problems
      .filter((entry) => entry.member !== null)
      .map((entry) => ({ member: entry.member, message: text(entry.problem) })),
    ...errors.filter((entry) => entry.member !== null),
  ];
  for (const entry of memberMessages) {
    const at = entry.member as number;
    byMember.set(at, [...(byMember.get(at) ?? []), entry.message]);
  }
  const daemon = errors.filter((entry) => entry.member === null).map((entry) => entry.message);
  return {
    name: [...ofField('name'), ...daemon],
    max: ofField('max'),
    members: ofField('members'),
    byMember,
  };
}

/** One pool: name, limit and remove in a row of one height, then the selectors, hints under the fields. */
export function PoolEditor({
  index,
  pools,
  problems,
  errors,
  touched,
  showAll,
  disabled,
  autoFocus,
  onTouch,
  onChange,
  onRemove,
}: {
  index: number;
  pools: readonly PoolDraft[];
  problems: { member: number | null; problem: PoolProblem }[];
  errors: { member: number | null; message: string }[];
  touched: Touched;
  showAll: boolean;
  disabled: boolean;
  autoFocus: boolean;
  onTouch: (field: PoolField) => void;
  onChange: (pool: PoolDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const pool = pools[index] as PoolDraft;
  const messages = useMessages(problems, errors, touched, showAll);
  const limit = (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...pool, max: event.target.value === '' ? null : Number(event.target.value) });
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-testid={`pool-${pool.name}`}>
      <div className="flex items-start gap-2">
        <PoolInput
          id={`pool-${index}-name`}
          className="min-w-0 flex-1"
          label={t('settingsPage.pools.name')}
          hint={t('settingsPage.pools.nameHint')}
          messages={messages.name}
          value={pool.name}
          disabled={disabled}
          autoFocus={autoFocus}
          onBlur={() => onTouch('name')}
          onChange={(event) => onChange({ ...pool, name: event.target.value })}
        />
        <PoolInput
          id={`pool-${index}-max`}
          className="w-32 shrink-0"
          label={t('settingsPage.pools.max')}
          hint={t('settingsPage.pools.maxHint')}
          messages={messages.max}
          type="number"
          min={POOL_MAX_RANGE[0]}
          max={POOL_MAX_RANGE[1]}
          value={pool.max === null ? '' : String(pool.max)}
          disabled={disabled}
          onBlur={() => onTouch('max')}
          onChange={limit}
        />
        <RemovePool disabled={disabled} onRemove={onRemove} />
      </div>
      <SelectorsField
        pools={pools}
        index={index}
        messages={messages}
        disabled={disabled}
        onChange={(next) => {
          onTouch('members');
          onChange({ ...pool, members: next });
        }}
      />
    </div>
  );
}

/** The fields the user has left, by pool index, and the pool that was just added (it gets the focus). */
export function usePoolTouches(clean: boolean) {
  const [touched, setTouched] = useState<Touched[]>([]);
  const [added, setAdded] = useState<number | null>(null);
  useEffect(() => {
    if (!clean) return;
    setTouched([]);
    setAdded(null);
  }, [clean]);
  return {
    touched,
    added,
    touch: (index: number, field: PoolField) =>
      setTouched((old) => Object.assign([...old], { [index]: { ...old[index], [field]: true } })),
    drop: (index: number) => {
      setTouched((old) => old.filter((_, at) => at !== index));
      setAdded(null);
    },
    focus: setAdded,
  };
}
