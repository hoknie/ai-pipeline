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
