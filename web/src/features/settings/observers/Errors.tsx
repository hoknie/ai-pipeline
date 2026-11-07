import type { FieldError } from '../../../shared/api/types.ts';

/** The messages of the server under a field. */
export function Errors({ errors }: { errors: FieldError[] }) {
  return errors.map((error) => (
    <p className="text-sm text-destructive" role="alert" key={`${error.path}:${error.message}`}>
      {error.message}
    </p>
  ));
}
