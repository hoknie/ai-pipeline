import { Textarea } from '../textarea.tsx';

export function JsonField({
  id,
  shown,
  locked,
  invalid,
  onChange,
}: {
  id: string;
  shown: unknown;
  locked: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const value = typeof shown === 'string' ? shown : JSON.stringify(shown ?? {}, null, 2);
  return (
    <Textarea
      id={id}
      rows={6}
      value={value}
      disabled={locked}
      aria-invalid={invalid}
      aria-describedby={`${id}-hint`}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
