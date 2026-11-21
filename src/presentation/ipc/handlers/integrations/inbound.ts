import { failureCode, type EventMeta } from '../../../../feature/integrations/types/index.ts';
import type { InboundAnswer } from '../../contract/index.ts';

import type { HandlerTable } from '../types.ts';

/** The refusal of the gate as one static word; the causes of an authentication failure stay one. */
function refused(error: unknown): InboundAnswer['status'] {
  switch (failureCode(error)) {
    case 'too_large':
      return 'too_large';
    case 'operation_denied':
    case 'scope_denied':
    case 'unknown_project':
      return 'operation_denied';
    case 'backend_unavailable':
    case 'backend_failed':
    case 'timeout':
    case 'internal':
      return 'unavailable';
    case null:
      return 'unavailable';
    default:
      return 'unauthenticated';
  }
}

/** Events of the service registries: checked by the daemon, one answer of static words. */
export const inboundHandlers = {
  integration_inbound: async (params, { services, log }) => {
    const seen: { meta?: EventMeta } = {};
    let answer: InboundAnswer;
    try {
      const outcome = await services.integrations.inbound.receive({
        verifier: params.kind,
        connectionId: params.connectionId,
        body: Buffer.from(params.body, 'base64'),
        headers: params.headers,
        onVerified: (labels) => {
          seen.meta = labels;
        },
      });
      if (outcome.status === 'ignored') {
        answer = { status: 'ignored', reason: outcome.reason };
      } else if (outcome.status === 'unknown_outcome') {
        answer = { status: 'unknown_outcome' };
      } else {
        const { item, duplicate } = outcome.result;
        answer = {
          status: outcome.status,
          ...(outcome.status === 'applied' && typeof item === 'string' ? { item } : {}),
          ...(duplicate === true ? { duplicate: true as const } : {}),
        };
      }
    } catch (error) {
      answer = { status: refused(error) };
    }
    const what = seen.meta === undefined ? '' : ` type=${seen.meta.type} path=${seen.meta.path}`;
    const why = answer.reason === undefined ? '' : ` ${answer.reason}`;
    log(
      `integration event: connection=${params.connectionId.replace(/[^A-Za-z0-9._:-]/g, '?')}${what} outcome=${answer.status}${why}`,
    );
    return answer;
  },
} satisfies Partial<HandlerTable>;
