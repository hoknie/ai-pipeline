import type { ReactNode } from 'react';

import { cn } from '../../../../shared/lib/browser/cn.ts';
import { Label } from '../../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../../shared/ui/forms/switch.tsx';

/** A titled group of fields of the properties column; sections are told apart by a line. */
export function FormSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      className={cn(
        'flex min-w-0 flex-col gap-3 border-0 border-t p-0 pt-3 first:border-t-0 first:pt-0',
        className,
      )}
    >
      <legend className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** A switch row: the label on the left, the switch on the right, the hint under the label. */
export function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
  hint,
  badge,
  action,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  hint?: ReactNode;
  /** Next to the label: where the value comes from. */
  badge?: ReactNode;
  /** After the badge: an icon button. */
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          {badge}
          {action}
        </div>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
