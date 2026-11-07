import { AppError } from '../../../platform/errors/index.ts';

export interface FieldError {
  /** File the error comes from, when known. */
  file?: string;
  path: string;
  message: string;
}

export type ConfigError =
  | { kind: 'no_files'; expected: string[] }
  | { kind: 'legacy'; found: string; expected: string }
  | { kind: 'read'; path: string; message: string }
  | { kind: 'syntax'; path: string; message: string }
  | { kind: 'invalid'; errors: FieldError[] };

export function describeConfigError(error: ConfigError): string {
  switch (error.kind) {
    case 'no_files': {
      const paths = [...error.expected];
      const last = paths.pop();
      return `no configuration found: expected ${paths.join(', ')} or ${last ?? ''}`;
    }
    case 'legacy':
      return `found ${error.found}, but the configuration now lives in ${error.expected} (settings.yaml, specialists/*.yaml, pipelines/*.yaml); move it there`;
    case 'read':
      return `cannot read ${error.path}: ${error.message}`;
    case 'syntax':
      return `${error.path}: ${error.message}`;
    case 'invalid':
      return [
        'invalid configuration:',
        ...error.errors.map(
          (field) => `  - ${field.file ? `${field.file}: ` : ''}${field.path}: ${field.message}`,
        ),
      ].join('\n');
  }
}

export class ConfigLoadError extends AppError {
  readonly detail: ConfigError;

  constructor(detail: ConfigError) {
    super('invalid', describeConfigError(detail), { code: 'config.load' });
    this.name = 'ConfigLoadError';
    this.detail = detail;
  }
}

/** The file or directory a load error that is not about the fields points at. */
function configErrorPath(detail: ConfigError): string {
  switch (detail.kind) {
    case 'read':
    case 'syntax':
      return detail.path;
    case 'legacy':
      return detail.found;
    case 'no_files':
      return detail.expected[0] ?? '';
    case 'invalid':
      return '';
  }
}

/** The errors of a configuration that did not load: its fields, or the one file it is about. */
export function configLoadErrors(error: ConfigLoadError): FieldError[] {
  const { detail } = error;
  return detail.kind === 'invalid'
    ? detail.errors
    : [{ path: configErrorPath(detail), message: error.message }];
}

/** The first error of a configuration that did not load, as one line. */
export function firstConfigError(error: ConfigLoadError): string {
  const { detail } = error;
  const first = detail.kind === 'invalid' ? detail.errors[0] : undefined;
  return first ? `${first.path}: ${first.message}` : error.message;
}
