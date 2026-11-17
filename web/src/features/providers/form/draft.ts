import { accessFields, hasOpencode } from './accessFields.ts';
import { SLUG_PATTERN } from './slug.ts';

export type FormStep = 'name' | 'access' | 'models';
export const FORM_STEPS: readonly FormStep[] = ['name', 'access', 'models'];

/** The model of a role in the form: the options are empty when they are not set. */
export interface ModelDraft {
  model: string;
  variant: string;
  effort: string;
}

export interface AccessDraft {
  kind: 'cli' | 'api';
  runtime: string;
  enabled: boolean;
  modelPrefix: string;
  baseUrl: string;
  keyEnv: string;
  command: string;
  args: string;
  /** The CLI goes to an own API address: both fields of the endpoint are written and required. */
  customEndpoint: boolean;
  /** The models of this access that replace the ones of the provider. */
  models: Record<string, ModelDraft>;
}

export interface ProviderDraft {
  slug: string;
  /** The slug was typed by hand: the name no longer changes it. */
  slugTouched: boolean;
  name: string;
  level: 'global' | 'project';
  enabled: boolean;
  access: AccessDraft[];
  models: Record<string, ModelDraft>;
}

export const emptyAccess = (runtime = 'claude'): AccessDraft => ({
  kind: 'cli',
  runtime,
  enabled: true,
  modelPrefix: '',
  baseUrl: '',
  keyEnv: '',
  command: '',
  args: '',
  customEndpoint: false,
  models: {},
});

export const emptyDraft = (): ProviderDraft => ({
  slug: '',
  slugTouched: false,
  name: '',
  level: 'global',
  enabled: true,
  access: [emptyAccess()],
  models: {},
});

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function modelOf(value: unknown): ModelDraft {
  if (typeof value === 'string') return { model: value, variant: '', effort: '' };
  const raw = isRaw(value) ? value : {};
  return {
    model: text(raw.model),
    variant: text(raw.variant),
    effort: text(raw.reasoning_effort),
  };
}

function modelsOf(value: unknown): Record<string, ModelDraft> {
  if (!isRaw(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([role, item]) => [role, modelOf(item)]));
}

function accessOf(value: unknown): AccessDraft {
  const raw = isRaw(value) ? value : {};
  const endpoint = isRaw(raw.endpoint) ? raw.endpoint : {};
  return {
    ...emptyAccess(text(raw.runtime) || 'claude'),
    kind: raw.kind === 'api' ? 'api' : 'cli',
    enabled: raw.enabled !== false,
    modelPrefix: text(raw.model_prefix),
    baseUrl: text(endpoint.base_url),
    keyEnv: text(endpoint.key_env),
    customEndpoint: isRaw(raw.endpoint),
    command: text(raw.command),
    args: Array.isArray(raw.args) ? raw.args.map(String).join(' ') : '',
    models: modelsOf(raw.models),
  };
}

/** The form of a provider file as it is now. */
export function draftOf(slug: string, raw: Raw, level: 'global' | 'project'): ProviderDraft {
  return {
    slug,
    slugTouched: true,
    name: text(raw.name),
    level,
    enabled: raw.enabled !== false,
    access: Array.isArray(raw.access) ? raw.access.map(accessOf) : [],
    models: modelsOf(raw.models),
  };
}

function modelValue(draft: ModelDraft, options: boolean): unknown {
  const extra = options && (draft.variant !== '' || draft.effort !== '');
  if (!extra) return draft.model;
  return {
    model: draft.model,
    ...(draft.variant === '' ? {} : { variant: draft.variant }),
    ...(draft.effort === '' ? {} : { reasoning_effort: draft.effort }),
  };
}

function modelsValue(models: Record<string, ModelDraft>, options: boolean) {
  const entries = Object.entries(models)
    .filter(([, draft]) => draft.model.trim() !== '')
    .map(([role, draft]) => [role, modelValue({ ...draft, model: draft.model.trim() }, options)]);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function accessValue(access: AccessDraft, level: 'global' | 'project', options: boolean): Raw {
  if (access.kind === 'api') return { kind: 'api', ...(access.enabled ? {} : { enabled: false }) };
  const fields = accessFields(access.runtime, level);
  const models = modelsValue(access.models, options);
  const endpoint = fields.endpoint && access.customEndpoint;
  const args = access.args.trim().split(/\s+/).filter(Boolean);
  return {
    kind: 'cli',
    runtime: access.runtime,
    ...(access.enabled ? {} : { enabled: false }),
    ...(fields.modelPrefix && access.modelPrefix.trim() !== ''
      ? { model_prefix: access.modelPrefix.trim() }
      : {}),
    ...(endpoint
      ? { endpoint: { base_url: access.baseUrl.trim(), key_env: access.keyEnv.trim() } }
      : {}),
    ...(fields.command && access.command.trim() !== '' ? { command: access.command.trim() } : {}),
    ...(fields.command && args.length > 0 ? { args } : {}),
    ...(models ? { models } : {}),
  };
}

/** The value to write to `providers/<slug>.yaml`; models of an empty role are left out. */
export function valueOf(draft: ProviderDraft): Raw {
  const options = hasOpencode(draft.access);
  const models = modelsValue(draft.models, options);
  return {
    name: draft.name.trim(),
    ...(draft.enabled ? {} : { enabled: false }),
    access: draft.access.map((access) => accessValue(access, draft.level, options)),
    ...(models ? { models } : {}),
  };
}

/** Whether two forms say the same. */
export const sameDraft = (a: ProviderDraft, b: ProviderDraft): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The step of the form that holds the field a daemon error points at. */
export function stepOfPath(path: string): FormStep {
  const field = fieldOfPath(path);
  if (field === '' || field === 'name' || field === 'enabled') return 'name';
  if (field.startsWith('models') || /^access\.\d+\.models/.test(field)) return 'models';
  return 'access';
}

/**
 * `swarm.providers.zai.access[0].model_prefix` → `access.0.model_prefix`; the form addresses fields
 * so; a path without the prefix is taken as it is. A path outside the provider (or the provider
 * itself) gives `''`: an error without a field.
 */
export function fieldOfPath(path: string): string {
  if (path.startsWith('swarm.') && !/^swarm\.providers\.[^.]+(\.|$)/.test(path)) return '';
  const rest = path.replace(/^swarm\.providers\.[^.]+\.?/, '');
  return rest.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
}

export type FormErrors = Record<string, string>;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const URL_PATTERN = /^https?:\/\/\S+$/;

function accessErrors(access: AccessDraft, index: number, level: 'global' | 'project'): FormErrors {
  const errors: FormErrors = {};
  if (access.kind === 'api') return errors;
  const fields = accessFields(access.runtime, level);
  const at = (name: string) => `access.${index}.${name}`;
  const prefix = access.modelPrefix.trim();
  if (fields.modelPrefix && prefix !== '' && /\s|^\/|\/$/.test(prefix)) {
    errors[at('model_prefix')] = 'prefixFormat';
  }
  if (!fields.endpoint || !access.customEndpoint) return errors;
  const url = access.baseUrl.trim();
  const key = access.keyEnv.trim();
  if (url === '') errors[at('endpoint.base_url')] = 'required';
  else if (url !== '' && !URL_PATTERN.test(url)) errors[at('endpoint.base_url')] = 'urlFormat';
  if (key === '') errors[at('endpoint.key_env')] = 'required';
  else if (key !== '' && !ENV_NAME.test(key)) errors[at('endpoint.key_env')] = 'keyNotName';
  return errors;
}

/** The problems the form sees by itself, by field; the values are codes of `providers.form.errors`. */
export function formErrors(
  draft: ProviderDraft,
  step: FormStep,
  taken: ReadonlySet<string>,
  isNew: boolean,
): FormErrors {
  if (step === 'name') {
    const errors: FormErrors = {};
    if (draft.name.trim() === '') errors.name = 'required';
    if (isNew && !SLUG_PATTERN.test(draft.slug)) errors.slug = 'slugFormat';
    else if (isNew && taken.has(draft.slug)) errors.slug = 'slugTaken';
    return errors;
  }
  if (step === 'models') return {};
  const errors: FormErrors = {};
  if (draft.access.length === 0) errors.access = 'accessNeeded';
  draft.access.forEach((access, index) =>
    Object.assign(errors, accessErrors(access, index, draft.level)),
  );
  return errors;
}
