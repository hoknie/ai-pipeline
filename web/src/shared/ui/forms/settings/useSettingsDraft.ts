import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../api/api.ts';
import type { ConfigEditorResponse, SettingValue } from '../../../api/types.ts';
import { notifySuccess } from '../../../lib/browser/notify.ts';
import type { SettingsScope } from '../../../lib/nav/settingsGroups.ts';
import { INHERIT, type DraftValue } from './SettingField.tsx';

export type Drafts = Record<string, DraftValue>;

/** The path a validation error belongs to: `swarm.` and the index of a list item are dropped. */
function fieldPathOf(path: string, known: ReadonlySet<string>): string | null {
  const bare = path.replace(/^swarm\./, '').replace(/\[\d+\]$/, '');
  if (known.has(bare)) return bare;
  const env = /^(runtimes\.[a-z]+\.env)\./.exec(bare);
  return env && known.has(env[1] as string) ? (env[1] as string) : null;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The errors of a failed write, split into those of known fields and the rest. */
function splitErrors(
  errors: { path: string; message: string }[],
  known: ReadonlySet<string>,
): { fields: Map<string, string>; others: string[] } {
  const fields = new Map<string, string>();
  const others: string[] = [];
  for (const error of errors) {
    const path = fieldPathOf(error.path, known);
    if (path === null) others.push(`${error.path}: ${error.message}`);
    else if (!fields.has(path)) fields.set(path, error.message);
  }
  return { fields, others };
}

/** The values to write: «inherit» and an empty list remove the key. */
function valuesOf(drafts: Drafts): Record<string, SettingValue> {
  const values: Record<string, SettingValue> = {};
  for (const [path, draft] of Object.entries(drafts)) {
    const value = draft === INHERIT ? null : draft;
    values[path] = Array.isArray(value) && value.length === 0 ? null : value;
  }
  return values;
}

/** What the last write and the file said: a conflict, a failure, errors of fields and others. */
interface Outcome {
  conflict: string | null;
  failure: string | null;
  fields: Map<string, string>;
  others: string[];
}
const NO_OUTCOME: Outcome = { conflict: null, failure: null, fields: new Map(), others: [] };

/** The draft of a form, the errors of the file and of the last write, and the write itself. */
export function useSettingsDraft({
  api,
  config,
  scope,
  known,
  onSaved,
  onDirty,
}: {
  api: Api;
  config: ConfigEditorResponse;
  scope: SettingsScope;
  known: ReadonlySet<string>;
  onSaved: () => Promise<void> | void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(NO_OUTCOME);
  const loadErrors = useMemo(
    () => splitErrors(config.errors, known).fields,
    [config.errors, known],
  );
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const errorOf = (path: string): string | null =>
    outcome.fields.get(path) ?? loadErrors.get(path) ?? null;
  /** A change that brings the field back to its saved value is no change. */
  const change = (path: string, value: DraftValue, saved: unknown) => {
    setDrafts((current) => {
      const { [path]: _old, ...rest } = current;
      return value !== INHERIT && same(value, saved) ? rest : { ...rest, [path]: value };
    });
  };
  const clear = (path: string) =>
    setDrafts((current) => {
      const { [path]: _old, ...rest } = current;
      return rest;
    });
  const discard = () => {
    setDrafts({});
    setOutcome(NO_OUTCOME);
  };
  const save = async () => {
    setBusy(true);
    setOutcome((current) => ({ ...current, conflict: null, failure: null }));
    try {
      const result = await api.writeSettings(
        valuesOf(drafts),
        config.settingsFiles[scope].revision,
        scope,
      );
      if (result.ok) {
        discard();
        notifySuccess(t('settingsPage.saved'));
        await onSaved();
      } else if (result.reason === 'conflict') {
        setOutcome((current) => ({ ...current, conflict: result.message }));
      } else {
        setOutcome({ ...NO_OUTCOME, ...splitErrors(result.errors, known) });
      }
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      setOutcome((current) => ({ ...current, failure }));
    } finally {
      setBusy(false);
    }
  };
  return { ...outcome, drafts, busy, dirty, errorOf, change, clear, discard, save };
}
