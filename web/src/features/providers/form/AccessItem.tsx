import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { RUNTIME_OPTIONS, accessFields } from './accessFields.ts';
import type { AccessDraft } from './draft.ts';
import { Field } from './FormParts.tsx';

type Errors = (field: string) => string | undefined;

/** The switch and the buttons of the order and removal of an access. */
function AccessTools({
  index,
  count,
  access,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  access: AccessDraft;
  onChange: (patch: Partial<AccessDraft>) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const n = index + 1;
  return (
    <div className="flex items-center gap-1">
      <Switch
        checked={access.enabled}
        aria-label={t('providers.form.accessEnabled', { n })}
        onCheckedChange={(enabled) => onChange({ enabled })}
      />
      <Button
        size="icon"
        variant="ghost"
        disabled={index === 0}
        aria-label={t('providers.form.accessUp', { n })}
        onClick={() => onMove(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={index === count - 1}
        aria-label={t('providers.form.accessDown', { n })}
        onClick={() => onMove(1)}
      >
        <ArrowDown />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('providers.form.accessRemove', { n })}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** The kind of the access (CLI; API is not available yet) and the CLI to run. */
function KindFields({
  id,
  access,
  onChange,
}: {
  id: (name: string) => string;
  access: AccessDraft;
  onChange: (patch: Partial<AccessDraft>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={id('kind')} label={t('providers.form.kind')} hint={t('providers.form.kindHint')}>
        <Select value={access.kind} onValueChange={(kind) => onChange({ kind: kind as 'cli' })}>
          <SelectTrigger id={id('kind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cli">CLI</SelectItem>
            <SelectItem value="api" disabled>
              {t('providers.form.apiSoon')}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field id={id('runtime')} label={t('providers.form.runtime')}>
        <Select value={access.runtime} onValueChange={(runtime) => onChange({ runtime })}>
          <SelectTrigger id={id('runtime')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RUNTIME_OPTIONS.map((runtime) => (
              <SelectItem key={runtime} value={runtime}>
                {runtime}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

interface FieldsProps {
  id: (name: string) => string;
  at: (name: string) => string;
  access: AccessDraft;
  errorOf: Errors;
  onChange: (patch: Partial<AccessDraft>) => void;
}

/** The address of the endpoint and the name of the variable that holds the key (never the key). */
function EndpointFields({ id, at, access, errorOf, onChange }: FieldsProps) {
  const { t } = useTranslation();
  const invalid = (name: string) => (errorOf(at(name)) ? true : undefined);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        id={id('base_url')}
        label={t('providers.form.baseUrl')}
        error={errorOf(at('endpoint.base_url'))}
      >
        <Input
          id={id('base_url')}
          value={access.baseUrl}
          placeholder="https://…"
          aria-invalid={invalid('endpoint.base_url')}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
      </Field>
      <Field
        id={id('key_env')}
        label={t('providers.form.keyEnv')}
        error={errorOf(at('endpoint.key_env'))}
        hint={t('providers.form.keyEnvHint')}
      >
        <Input
          id={id('key_env')}
          value={access.keyEnv}
          placeholder="ZAI_API_KEY"
          autoComplete="off"
          aria-invalid={invalid('endpoint.key_env')}
          onChange={(event) => onChange({ keyEnv: event.target.value })}
        />
      </Field>
    </div>
  );
}

/** The switch «own API address for the CLI»; the address and the key variable only with it on. */
function CustomEndpoint(props: FieldsProps) {
  const { id, access, onChange } = props;
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Switch
          id={id('custom_endpoint')}
          checked={access.customEndpoint}
          onCheckedChange={(customEndpoint) => onChange({ customEndpoint })}
        />
        <label htmlFor={id('custom_endpoint')} className="flex flex-col gap-0.5 text-sm">
          <span className="font-medium">{t('providers.form.customEndpoint')}</span>
          <span className="text-xs text-muted-foreground">
            {t('providers.form.customEndpointHint')}
          </span>
        </label>
      </div>
      {access.customEndpoint ? <EndpointFields {...props} /> : null}
    </div>
  );
}

/** `command` and `args` of the CLI (the shared level only). */
function CommandFields({ id, at, access, errorOf, onChange }: FieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={id('command')} label="command" error={errorOf(at('command'))}>
        <Input
          id={id('command')}
          value={access.command}
          onChange={(event) => onChange({ command: event.target.value })}
        />
      </Field>
      <Field id={id('args')} label="args" error={errorOf(at('args'))}>
        <Input
          id={id('args')}
          value={access.args}
          onChange={(event) => onChange({ args: event.target.value })}
        />
      </Field>
    </div>
  );
}

/** The fields the CLI takes: the prefix, the endpoint, the command. */
function CliFields(props: FieldsProps & { level: 'global' | 'project' }) {
  const { id, at, access, level, errorOf, onChange } = props;
  const { t } = useTranslation();
  const fields = accessFields(access.runtime, level);
  return (
    <>
      {fields.modelPrefix ? (
        <Field
          id={id('model_prefix')}
          label="model_prefix"
          error={errorOf(at('model_prefix'))}
          hint={t('providers.form.modelPrefixHint')}
        >
          <Input
            id={id('model_prefix')}
            value={access.modelPrefix}
            aria-invalid={errorOf(at('model_prefix')) ? true : undefined}
            onChange={(event) => onChange({ modelPrefix: event.target.value })}
          />
        </Field>
      ) : null}
      {fields.endpoint ? <CustomEndpoint {...props} /> : null}
      {fields.command ? <CommandFields {...props} /> : null}
    </>
  );
}

/** One access of the list: kind, CLI, the fields that CLI takes and the buttons of the order. */
export function AccessItem(props: {
  index: number;
  count: number;
  access: AccessDraft;
  level: 'global' | 'project';
  errorOf: Errors;
  onChange: (patch: Partial<AccessDraft>) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { index, access, level, errorOf, onChange } = props;
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('providers.form.accessN', { n: index + 1 })}</span>
        <AccessTools {...props} />
      </div>
      <KindFields id={(name) => `access-${index}-${name}`} access={access} onChange={onChange} />
      <CliFields
        id={(name) => `access-${index}-${name}`}
        at={(name) => `access.${index}.${name}`}
        access={access}
        level={level}
        errorOf={errorOf}
        onChange={onChange}
      />
    </li>
  );
}
