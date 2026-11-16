import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { matchingOptions, withValues, type PickerOption } from './pickerParts.tsx';

/** The open state, the query and the edits of a multiselect with a searchable list. */
export function usePickerState({
  values,
  onChange,
  options,
  creatable,
  validate,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: PickerOption[];
  creatable: boolean;
  validate?: (value: string) => string | null;
}) {
  const listId = useId();
  const [open, setOpenState] = useState(false);
  const [query, setQueryState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const typed = query.trim();
  const visible = matchingOptions(options, typed);
  const canCreate = creatable && typed !== '' && !options.some((option) => option.name === typed);

  const setQuery = (next: string) => {
    setQueryState(next);
    setError(null);
  };
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) setQuery('');
  };
  /** Adds the values; one that `validate` refuses stays out and its message is shown, the text stays. */
  const add = (added: string[]) => {
    let refusal: string | null = null;
    const accepted = added.filter((raw) => {
      const value = raw.trim();
      if (value === '' || validate === undefined) return true;
      const problem = validate(value);
      refusal ??= problem;
      return problem === null;
    });
    const next = withValues(values, accepted);
    if (next.length !== values.length) onChange(next);
    if (refusal === null) setQuery('');
    else setError(refusal);
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
    error,
    typed,
    visible,
    canCreate,
    add,
    onPaste,
    onKeyDown,
  };
}
