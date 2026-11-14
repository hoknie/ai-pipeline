import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReasoningEffort } from '../../../../../src/feature/swarm-config/types/index.ts';

import type {
  CatalogEntry,
  ConfigCatalogResponse,
  EditorChain,
  EditorMcpServer,
} from '../../../shared/api/types.ts';
import { Input } from '../../../shared/ui/forms/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { Textarea } from '../../../shared/ui/forms/textarea.tsx';
import { ValuesPicker } from '../../../shared/ui/forms/ValuesPicker.tsx';
import { ModelField } from '../../../shared/ui/forms/picker/ModelField.tsx';
import { isList, type Draft, type FieldName, type ListField } from './draft.ts';

export const RUNTIMES = ['claude', 'opencode', 'agy'] as const;
const PERMISSIONS = ['read', 'edit', 'full'];
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[];
/** Radix `Select` has no empty value: this one stands for «take it from defaults». */
const INHERIT = '__inherit';

export function fieldLabel(field: FieldName, t: TFunction): string {
  return t(`specialists.fields.${field}`);
}

/** What an empty field falls back to, as a hint; empty when there is nothing to say. */
export function hintOf(field: FieldName, defaults: Record<string, unknown>, t: TFunction): string {
  if (field === 'variant' || field === 'reasoning_effort') return t('specialists.opencodeDefault');
  if (field === 'runtime' || field === 'permissions' || field === 'timeout') {
    return t('specialists.fromDefaults', { value: String(defaults[`defaults.${field}`] ?? '') });
  }
  if (field === 'allow_commands') {
    const inherited = defaults[`defaults.${field}`];
    return Array.isArray(inherited) && inherited.length > 0
      ? t('specialists.fromDefaults', { value: inherited.join(', ') })
      : '';
  }
  return '';
}

/** The tools the defaults give to a specialist that names none. */
export function inheritedToolsOf(defaults: Record<string, unknown>): string[] {
  const inherited = defaults['defaults.tools'];
  return Array.isArray(inherited) ? inherited.map(String) : [];
}

export interface InputProps {
  field: FieldName;
  draft: Draft;
  onDraft: (update: (current: Draft) => Draft) => void;
  disabled: boolean;
  invalid: boolean;
  defaults: Record<string, unknown>;
  catalog: ConfigCatalogResponse | null;
  /** The control of the field `tags`. */
  tags: ReactNode;
  chains?: EditorChain[];
  /** The servers of the MCP catalog; the field `mcp_servers` offers them. */
  mcpServers?: EditorMcpServer[];
}

/** The choice of the servers of the MCP catalog; a name the catalog lacks stays with a note. */
function McpServersInput({ draft, onDraft, disabled, invalid, mcpServers = [] }: InputProps) {
  const { t } = useTranslation();
  return (
    <ValuesPicker
      id="field-mcp_servers"
      label={fieldLabel('mcp_servers', t)}
      values={draft.mcp_servers}
      onChange={(items) => onDraft((current) => ({ ...current, mcp_servers: items }))}
      options={mcpServers
        .filter((server) => !server.allSpecialists)
        .map((server) => ({ name: server.name, source: 'project', description: server.command }))}
      mark={(value) =>
        mcpServers.some((server) => server.name === value) ? null : t('specialists.notInCatalog')
      }
      headings={{ project: '' }}
      creatable={false}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

/** The tools or skills to choose from, with a note on the ones the runtime does not know. */
function ListInput({
  field,
  draft,
  onDraft,
  disabled,
  invalid,
  defaults,
  catalog,
}: InputProps & { field: ListField }) {
  const { t } = useTranslation();
  const runtime = draft.runtime || String(defaults['defaults.runtime'] ?? 'claude');
  const runtimeName = RUNTIMES.find((name) => name === runtime) ?? 'claude';
  const known: CatalogEntry[] | null =
    field === 'tools' || field === 'skills'
      ? (catalog?.runtimes[runtimeName]?.[field] ?? null)
      : null;
  const mark = (value: string): string | null => {
    if (!known) return null;
    if (!known.some((entry) => entry.name === value)) return t('picker.notFound');
    return field === 'tools' &&
      runtime === 'claude' &&
      value.startsWith('mcp__') &&
      !catalog?.mcpInherited
      ? t('picker.mcpIsolated')
      : null;
  };
  return (
    <ValuesPicker
      id={`field-${field}`}
      label={fieldLabel(field, t)}
      values={draft[field]}
      onChange={(items) => onDraft((current) => ({ ...current, [field]: items }))}
      options={field === 'allow_commands' ? [] : (known ?? [])}
      inherited={field === 'tools' && draft.tools.length === 0 ? inheritedToolsOf(defaults) : []}
      mark={field === 'allow_commands' ? undefined : mark}
      disabled={disabled}
      invalid={invalid}
    />
  );
}

/** The choice of the runtime chain; «none» keeps the single runtime of the specialist. */
function ChainSelect({
  value,
  chains,
  disabled,
  invalid,
  onChange,
}: {
  value: string;
  chains: EditorChain[];
  disabled: boolean;
  invalid: boolean;
  onChange: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value || '__none'}
      disabled={disabled}
      onValueChange={(val) => onChange(val === '__none' ? '' : val)}
    >
      <SelectTrigger id="field-runtime_chain" aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">{t('specialists.noChain')}</SelectItem>
        {chains.map((c) => (
          <SelectItem key={c.slug} value={c.slug}>
            {String(c.raw.name || c.slug)} ({c.slug})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The control of one field of the form. */
export function FieldInput(props: InputProps) {
  const { field, draft, onDraft, disabled, invalid, defaults, tags, chains } = props;
  const { t } = useTranslation();
  if (field === 'tags') return tags;
  if (field === 'mcp_servers') return <McpServersInput {...props} />;
  if (isList(field)) return <ListInput {...props} field={field} />;
  const set = (text: string) => onDraft((current) => ({ ...current, [field]: text }));
  const hint = hintOf(field, defaults, t);
  if (field === 'runtime_chain') {
    return (
      <ChainSelect
        value={draft.runtime_chain}
        chains={chains ?? []}
        disabled={disabled}
        invalid={invalid}
        onChange={set}
      />
    );
  }
  if (field === 'runtime' || field === 'permissions' || field === 'reasoning_effort') {
    const options =
      field === 'runtime' ? RUNTIMES : field === 'permissions' ? PERMISSIONS : REASONING_EFFORTS;
    return (
      <Select
        value={draft[field] === '' ? INHERIT : draft[field]}
        disabled={disabled}
        onValueChange={(value) => set(value === INHERIT ? '' : value)}
      >
        <SelectTrigger id={`field-${field}`} aria-invalid={invalid}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>{hint || t('specialists.byDefault')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field === 'model') {
    return (
      <ModelField
        id="field-model"
        runtime={draft.runtime || String(defaults['defaults.runtime'] ?? 'claude')}
        value={draft.model}
        disabled={disabled}
        invalid={invalid}
        placeholder={hint}
        onChange={set}
      />
    );
  }
  const common = {
    id: `field-${field}`,
    value: draft[field],
    disabled,
    'aria-invalid': invalid,
    onChange: (event: { target: { value: string } }) => set(event.target.value),
  };
  if (field === 'prompt') {
    return (
      <Textarea
        {...common}
        rows={10}
        placeholder={hint}
        spellCheck={false}
        className="font-mono text-xs"
      />
    );
  }
  return <Input type="text" {...common} placeholder={hint} />;
}
