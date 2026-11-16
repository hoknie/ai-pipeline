import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../button.tsx';
import { Input } from '../input.tsx';
import { Messages, PoolEditor, usePoolTouches } from './PoolEditor.tsx';
import type { EditorSetting } from '../../../api/types.ts';
import {
  bindPoolErrors,
  poolProblems,
  poolsFromValue,
  POOL_MAX_RANGE,
  type PoolDraft,
} from './poolsDraft.ts';

/** «Other attempts»: the quota of the attempts no pool takes. */
function DefaultPoolField({
  value,
  error,
  disabled,
  onChange,
}: {
  value: number | null;
  error: string | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label
        className="flex flex-col gap-1 text-sm font-medium"
        htmlFor="field-queue.default_pool.max"
      >
        {t('settingsPage.field.queue_default_pool_max.label')}
      </label>
      <Input
        id="field-queue.default_pool.max"
        type="number"
        min={POOL_MAX_RANGE[0]}
        max={POOL_MAX_RANGE[1]}
        value={value === null ? '' : String(value)}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
      <Messages messages={error === null ? [] : [error]} />
      <p className="text-xs text-muted-foreground">
        {t('settingsPage.field.queue_default_pool_max.hint')}{' '}
        <code className="text-xs">queue.default_pool.max</code>
      </p>
    </>
  );
}

function AddPoolButton({ disabled, onAdd }: { disabled: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="outline" className="w-fit" disabled={disabled} onClick={onAdd}>
      <Plus />
      {t('settingsPage.pools.add')}
    </Button>
  );
}

function PoolsIntro({ path, empty }: { path: string; empty: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t('settingsPage.field.queue_pools.hint')} <code className="text-xs">{path}</code>
      </p>
      {empty ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          {t('settingsPage.pools.empty')}
        </p>
      ) : null}
    </>
  );
}

function savedNumber(setting: EditorSetting | undefined): number | null {
  const value = setting?.written.global ?? setting?.value;
  return typeof value === 'number' ? value : null;
}

/** The card of the pools of the queue: the pools and «Other attempts», the quota outside every pool. */
export function PoolsField({
  setting,
  fallback,
  drafts,
  defaultValue,
  errors,
  error,
  defaultError,
  disabled,
  onPools,
  onDefault,
}: {
  setting: EditorSetting;
  fallback: EditorSetting | undefined;
  drafts: PoolDraft[] | undefined;
  defaultValue: number | null;
  errors: { path: string; message: string }[];
  error: string | null;
  defaultError: string | null;
  disabled: boolean;
  onPools: (pools: PoolDraft[], saved: PoolDraft[]) => void;
  onDefault: (value: number | null, saved: number | null) => void;
}) {
  const touches = usePoolTouches(drafts === undefined);
  const saved = poolsFromValue(setting.written.global ?? setting.value);
  const pools = drafts ?? saved;
  const savedDefault = savedNumber(fallback);
  const problems = poolProblems(pools);
  const bound = bindPoolErrors(pools, errors);
  const update = (next: PoolDraft[]) => {
    onPools(next, saved);
    if (next.length === 0) onDefault(null, savedDefault);
    else if (pools.length === 0 && defaultValue === null) onDefault(1, savedDefault);
  };
  return (
    <div className="flex flex-col gap-3" data-testid={`setting-${setting.path}`}>
      <PoolsIntro path={setting.path} empty={pools.length === 0} />
      {pools.map((pool, index) => (
        <PoolEditor
          key={index}
          index={index}
          pools={pools}
          disabled={disabled}
          autoFocus={touches.added === index}
          touched={touches.touched[index] ?? {}}
          showAll={error !== null}
          problems={problems.filter((entry) => entry.pool === index)}
          errors={bound.filter((entry) => entry.pool === index)}
          onTouch={(field) => touches.touch(index, field)}
          onChange={(changed) => update(pools.map((old, at) => (at === index ? changed : old)))}
          onRemove={() => {
            touches.drop(index);
            update(pools.filter((_, at) => at !== index));
          }}
        />
      ))}
      <Messages
        messages={[
          ...(error === null ? [] : [error]),
          ...bound.filter((entry) => entry.pool === -1).map((entry) => entry.message),
        ]}
      />
      <AddPoolButton
        disabled={disabled}
        onAdd={() => {
          touches.focus(pools.length);
          update([...pools, { name: '', max: 1, members: [] }]);
        }}
      />
      {pools.length > 0 ? (
        <DefaultPoolField
          value={defaultValue}
          error={defaultError}
          disabled={disabled}
          onChange={(value) => onDefault(value, savedDefault)}
        />
      ) : null}
    </div>
  );
}
