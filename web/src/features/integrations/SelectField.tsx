import type { ReactNode } from 'react';

import { Label } from '../../shared/ui/forms/label.tsx';

/** A labelled native select; its options are the children. */
export function SelectField({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-48 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        className="h-9.5 rounded-md border border-input bg-card px-2 text-sm"
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </div>
  );
}
