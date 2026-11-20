import type { IntegrationTypeView } from '../../../shared/api/types.ts';

/** The kind of the service registry: its page has the check and the links of the projects. */
export const REGISTRY_KIND = 'service-registry';

/**
 * The kinds of the catalog, in the order of the daemon: those without a command of their own
 * (`createdBy`); webhooks have a tab of their own.
 */
export function catalogKinds(types: readonly IntegrationTypeView[]): IntegrationTypeView[] {
  return types.filter((type) => type.createdBy === undefined && type.kind !== 'webhook');
}
