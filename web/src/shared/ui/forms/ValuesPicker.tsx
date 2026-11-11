import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/browser/cn.ts';
import { Command, CommandInput } from '../overlays/command.tsx';
import { Popover, PopoverContent } from '../overlays/popover.tsx';
import {
  AddTrigger,
  PickerChips,
  PickerList,
  withValues,
  type OptionSource,
  type ValueLook,
  type PickerOption,
} from './picker/pickerParts.tsx';
import { usePickerState } from './picker/usePickerState.ts';

export { withValues };
export type { OptionSource, PickerOption };

interface ValuesPickerProps {
  id?: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options?: PickerOption[];
  /** Values taken from defaults: shown as grey chips, not removable. */
  inherited?: string[];
  /** A note shown next to a value, such as «not found»; null for none. */
  mark?: (value: string) => string | null;
  /** The text of a chosen value in its chip and in the remove button; default: the value itself. */
  display?: (value: string) => string;
  /** A mark before a value, such as a color dot; null for none. */
  icon?: ValueLook['icon'];
  /** The tooltip of a value instead of its text, such as a path. */
  hint?: ValueLook['hint'];
  /** Group headings instead of the names of the sources; an empty string shows no heading. */
  headings?: Partial<Record<OptionSource, string>>;
  creatable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Extra classes of the popover with the list. */
  contentClassName?: string;
}

/**
 * A multiselect: chips for the chosen values and a popover with a searchable list. A value that
 * is not in `options` can be typed in when `creatable`; `inherited` chips are grey and cannot be removed.
 */
export function ValuesPicker(props: ValuesPickerProps) {
  const { id, label, values, onChange, options = [], inherited = [], mark, display } = props;
  const look: ValueLook = { icon: props.icon, hint: props.hint };
  const { headings, creatable = true, disabled = false, invalid = false } = props;
  const { t } = useTranslation();
  const picker = usePickerState({ values, onChange, options, creatable });
  return (
    <Popover open={picker.open} onOpenChange={picker.setOpen}>
      <div
        className="flex min-h-9.5 min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card p-1.5 aria-invalid:border-destructive"
        aria-invalid={invalid}
      >
        <PickerChips
          inherited={inherited}
          values={values}
          display={display}
          look={look}
          mark={mark}
          disabled={disabled}
          onRemove={(value) => onChange(values.filter((candidate) => candidate !== value))}
        />
        <AddTrigger
          id={id}
          label={label}
          open={picker.open}
          listId={picker.listId}
          disabled={disabled}
        />
      </div>
      <PopoverContent className={cn('p-0', props.contentClassName)}>
        <Command shouldFilter={false} label={t('picker.search', { label })}>
          <CommandInput
            value={picker.query}
            onValueChange={picker.setQuery}
            onPaste={picker.onPaste}
            onKeyDown={picker.onKeyDown}
            placeholder={creatable ? t('picker.searchOrType') : t('picker.searchOnly')}
          />
          <PickerList
            listId={picker.listId}
            options={options}
            visible={picker.visible}
            typed={picker.typed}
            canCreate={picker.canCreate}
            values={values}
            headings={headings}
            mark={mark}
            display={display}
            look={look}
            onAdd={picker.add}
          />
        </Command>
      </PopoverContent>
    </Popover>
  );
}
