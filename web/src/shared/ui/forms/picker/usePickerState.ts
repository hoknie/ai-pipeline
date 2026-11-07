import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { matchingOptions, withValues, type PickerOption } from './pickerParts.tsx';

/** The open state, the query and the edits of a multiselect with a searchable list. */
export function usePickerState({
  values,
  onChange,
  options,
  creatable,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: PickerOption[];
  creatable: boolean;
}) {
  const listId = useId();
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const visible = matchingOptions(options, typed);
  const canCreate = creatable && typed !== '' && !options.some((option) => option.name === typed);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) setQuery('');
  };
  const add = (added: string[]) => {
    const next = withValues(values, added);
    if (next.length !== values.length) onChange(next);
    setQuery('');
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!creatable || !/[\r\n]/.test(text)) return;
    event.preventDefault();
    add(text.split(/\r?\n/));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && query === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return {
    listId,
    open,
    setOpen,
    query,
    setQuery,
    typed,
    visible,
    canCreate,
    add,
    onPaste,
    onKeyDown,
  };
}
