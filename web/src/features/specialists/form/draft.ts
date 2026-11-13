export type FieldName =
  | 'name'
  | 'runtime_chain'
  | 'model'
  | 'variant'
  | 'reasoning_effort'
  | 'runtime'
  | 'permissions'
  | 'timeout'
  | 'allow_commands'
  | 'tools'
  | 'skills'
  | 'mcp_servers'
  | 'max'
  | 'prompt'
  | 'tags';

export const FIELDS: FieldName[] = [
  'name',
  'runtime_chain',
  'runtime',
  'model',
  'variant',
  'reasoning_effort',
  'permissions',
  'timeout',
  'allow_commands',
  'tools',
  'skills',
  'mcp_servers',
  'max',
  'prompt',
  'tags',
];
export type ListField = 'allow_commands' | 'tools' | 'skills' | 'mcp_servers' | 'tags';
const LIST_FIELDS = new Set<FieldName>([
  'allow_commands',
  'tools',
  'skills',
  'mcp_servers',
  'tags',
]);

export const isList = (field: FieldName): field is ListField => LIST_FIELDS.has(field);

export type Draft = Record<Exclude<FieldName, ListField>, string> & Record<ListField, string[]>;

export function draftOf(raw: Record<string, unknown>): Draft {
  const draft: Record<string, string | string[]> = {};
  for (const field of FIELDS) {
    const value = raw[field];
    if (isList(field)) {
      draft[field] = Array.isArray(value)
        ? value.map(String)
        : value === undefined || value === null || value === ''
          ? []
          : [String(value)];
    } else {
      draft[field] = value === undefined || value === null ? '' : String(value);
    }
  }
  return draft as Draft;
}

/** The file content for a draft: empty fields are left out, keys the form does not know stay. */
export function valueOf(draft: Draft, raw: Record<string, unknown>): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (isList(field)) {
      const items = draft[field].map((item) => item.trim()).filter((item) => item !== '');
      if (items.length > 0) filled[field] = items;
      continue;
    }
    const text = draft[field];
    if (text === undefined || text === null) continue;
    if (field === 'prompt') {
      if (text.trim() !== '') filled[field] = text;
    } else if (text.trim() !== '') {
      filled[field] =
        field === 'max' && /^\d+$/.test(text.trim()) ? Number(text.trim()) : text.trim();
    }
  }
  const chain = draft.runtime_chain ? draft.runtime_chain.trim() : '';
  if (chain !== '') {
    delete filled.runtime;
    delete filled.model;
    delete filled.variant;
    delete filled.reasoning_effort;
  }
  // keys of the file keep their place; new ones follow in form order
  const value: Record<string, unknown> = {};
  for (const [key, original] of Object.entries(raw)) {
    if (
      chain !== '' &&
      (key === 'runtime' || key === 'model' || key === 'variant' || key === 'reasoning_effort')
    ) {
      continue;
    }
    if (chain === '' && key === 'runtime_chain') {
      continue;
    }
    if (!(FIELDS as string[]).includes(key)) value[key] = original;
    else if (key in filled) value[key] = filled[key];
  }
  for (const field of FIELDS)
    if (field in filled && !(field in value)) value[field] = filled[field];
  return value;
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return FIELDS.every((field) => {
    const left = a[field];
    const right = b[field];
    return Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((item, index) => item === right[index])
      : left === right;
  });
}

/** The field a validation error is about; `prefix` is the path before the field, with its dot. */
export function fieldOf(path: string, prefix: string): FieldName | null {
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length).split(/[.[]/)[0] as FieldName;
  return FIELDS.includes(name) ? name : null;
}
