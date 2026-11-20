import type { CheckResult } from '../../integrations/types/index.ts';

/** The secrets of one connection as the adapter reads them. */
export interface RegistrySecrets {
  read(slot: string): Promise<string>;
}

export interface RegistryCheckRequest {
  params: Readonly<Record<string, string>>;
  secrets: RegistrySecrets;
  signal: AbortSignal;
}

export type { CheckResult };
