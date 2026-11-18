import type { InboundOperation, OperationResult } from '../types/index.ts';

/**
 * What a verified inbound event may do in the domain: set against the arrows of the graph by the
 * composition root, which routes it to the services of the queue and the runs.
 */
export interface IntegrationOperationsPort {
  perform(project: string, operation: InboundOperation): Promise<OperationResult>;
}
