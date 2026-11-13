import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConfigEditResult, FieldError, McpServerValue } from '../../../shared/api/types.ts';
import type { McpRow } from './useMcpServers.ts';

/** `create` has no server yet; `edit` changes one of this level; `override` copies a shared one. */
export type McpFormMode = 'create' | 'edit' | 'override';

export interface Problems {
  name: string | null;
  command: string | null;
  args: string | null;
  env: string | null;
  other: string[];
}

/** The messages of the errors of a write, sorted by the field they belong to. */
function problemsOf(errors: FieldError[], name: string): Problems {
  const problems: Problems = { name: null, command: null, args: null, env: null, other: [] };
  const base = `swarm.mcp_servers.${name}`;
  for (const error of errors) {
    if (error.path === base) problems.name = error.message;
    else if (error.path === `${base}.command`) problems.command = error.message;
    else if (error.path.startsWith(`${base}.args`)) problems.args = error.message;
    else if (error.path.startsWith(`${base}.env`)) problems.env = error.message;
    else problems.other.push(`${error.path}: ${error.message}`);
  }
  return problems;
}

type Drafts = Record<string, string | null>;

/** The request to write: a saved variable that the draft leaves alone is sent as `null`. */
function valueOf(
  command: string,
  argsText: string,
  allSpecialists: boolean,
  saved: string[],
  drafts: Drafts,
): McpServerValue {
  const env: Record<string, string | null> = {};
  for (const name of saved) if (drafts[name] !== null) env[name] = drafts[name] ?? null;
  for (const [name, value] of Object.entries(drafts)) {
    if (!saved.includes(name) && value !== null) env[name] = value;
  }
  const args = argsText.split('\n').filter((line) => line.trim() !== '');
  return { command: command.trim(), args, env, allSpecialists };
}

/**
 * The state of the form of one server: the fields, the drafts of the variables, the errors of
 * the last write and the write itself. `onDirty` tells whether anything differs from `initial`.
 */
export function useMcpServerForm(props: {
  mode: McpFormMode;
  initial: McpRow | null;
  names: string[];
  onSave: (name: string, value: McpServerValue) => Promise<ConfigEditResult>;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { mode, initial, names, onSave, onClose, onDirty } = props;
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [argsText, setArgsText] = useState((initial?.args ?? []).join('\n'));
  const [allSpecialists, setAllSpecialists] = useState(initial?.allSpecialists ?? false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // An overridden shared server has no values in the project file to keep.
  const saved = useMemo(
    () => (mode === 'edit' ? (initial?.envNames ?? []) : []),
    [mode, initial?.envNames],
  );
  const changed =
    name !== (initial?.name ?? '') ||
    command !== (initial?.command ?? '') ||
    argsText !== (initial?.args ?? []).join('\n') ||
    allSpecialists !== (initial?.allSpecialists ?? false) ||
    Object.keys(drafts).length > 0;
  useEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);

  const problems = problemsOf(errors, name);
  const taken = mode === 'create' && names.includes(name);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setConflict(null);
    try {
      const result = await onSave(name, valueOf(command, argsText, allSpecialists, saved, drafts));
      if (result.ok) {
        onDirty(false);
        onClose();
      } else if (result.reason === 'conflict') setConflict(result.message);
      else setErrors(result.errors);
    } finally {
      setBusy(false);
    }
  };
  return {
    fields: { name, command, argsText, allSpecialists, drafts, saved },
    set: { setName, setCommand, setArgsText, setAllSpecialists, setDrafts },
    problems: { ...problems, name: taken ? t('settingsPage.mcp.taken') : problems.name },
    conflict,
    busy,
    canSave: !busy && !taken && name !== '' && command !== '',
    submit,
  };
}

export type McpServerFormState = ReturnType<typeof useMcpServerForm>;
