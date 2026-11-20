import type { IntegrationTypeView } from '../../../shared/api/types.ts';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';

export type Param = IntegrationTypeView['params'][number];

/** The values of the form that differ from the connection: what to set, what to remove. */
export function paramsChange(
  params: readonly Param[],
  current: Readonly<Record<string, string>>,
  draft: Readonly<Record<string, string>>,
): { set: Record<string, string>; unset: string[] } {
  const set: Record<string, string> = {};
  const unset: string[] = [];
  for (const param of params) {
    const before = current[param.name] ?? '';
    const after = (draft[param.name] ?? before).trim();
    if (after === before) continue;
    if (after === '') {
      if (!param.required) unset.push(param.name);
    } else {
      set[param.name] = after;
    }
  }
  return { set, unset };
}

/** One non-secret parameter of a kind: a text field, or a choice when the kind lists the values. */
export function ParamField({
  param,
  value,
  onChange,
  prefix = 'param',
}: {
  param: Param;
  value: string;
  onChange: (value: string) => void;
  /** Keeps the ids apart when several forms are on the page. */
  prefix?: string;
}) {
  const id = `${prefix}-${param.name}`;
  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1">
      <Label htmlFor={id}>
        {param.name}
        {param.required ? ' *' : ''}
      </Label>
      {param.values === undefined ? (
        <Input
          id={id}
          value={value}
          maxLength={param.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <select
          id={id}
          value={value}
          className="h-9.5 rounded-md border border-input bg-card px-2 text-sm"
          onChange={(event) => onChange(event.target.value)}
        >
          {param.required ? null : <option value="" />}
          {param.values.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
