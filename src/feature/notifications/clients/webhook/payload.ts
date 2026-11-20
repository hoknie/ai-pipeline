import {
  webhookType,
  withoutPaths,
  type Closure,
  type DeliveryKind,
  type EventData,
} from '../../types/index.ts';

/** The longest body of a request. */
export const BODY_LIMIT = 256 * 1024;

/** The status the group of an event was in when it was born. */
const GROUP_STATUS: Partial<Record<DeliveryKind, string>> = {
  question: 'needs_human',
  question_closed: 'needs_human',
  failed: 'failed',
  conflict: 'conflict',
  delivery: 'apply_failed',
};

export interface WebhookEvent {
  kind: DeliveryKind;
  /** Unique per event; the receiver may deduplicate by it. */
  key: string;
  run: string;
  data: EventData;
  /** When the event happened (ms). */
  at: number;
  /** The link to the panel, or null when it has no public address. */
  url: string | null;
}

const clean = (text: string): string => withoutPaths(text, '');

/** What to cut from the texts of an event to make the body fit: how many characters each may keep. */
interface Cut {
  text: number;
  option: number;
}

function cut(text: string, max: number | null): string {
  const chars = [...text];
  return max === null || chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

function closedBy(closure: Closure | undefined): string {
  if (closure === undefined) return 'other';
  return closure.by === 'channel' ? closure.channel : closure.by;
}

function typed(event: WebhookEvent, limits: Cut | null): Record<string, unknown> {
  const { data } = event;
  const text = (value: string | null): string | null =>
    value === null ? null : cut(clean(value), limits?.text ?? null);
  switch (event.kind) {
    case 'question':
      return {
        question:
          data.questions === null
            ? text(data.question)
            : data.questions.map((one) => ({
                text: text(one.text),
                options: one.options.map((option) => cut(clean(option), limits?.option ?? null)),
                recommendation: text(one.recommendation),
              })),
        human_only: data.humanOnly !== null,
      };
    case 'question_closed':
      return { closed: { by: closedBy(data.closure) } };
    case 'finished':
      return {
        result: data.outcome,
        groups: { merged: data.merged, total: data.groups },
      };
    case 'failed':
    case 'conflict':
    case 'delivery':
      return { reason: text(data.reason) };
    case 'test':
      return { message: 'aip webhook test' };
  }
}

function build(event: WebhookEvent, limits: Cut | null, truncated: boolean): string {
  const { data } = event;
  const isTest = event.kind === 'test';
  // The keys are written in this order, always: the bytes of the body are what is signed.
  const body = {
    type: webhookType(event.kind),
    timestamp: new Date(event.at).toISOString(),
    data: {
      schema: 1,
      key: event.key,
      task: isTest
        ? null
        : {
            id: event.run,
            number: data.number,
            title: limits === null ? data.title : cut(clean(data.title), limits.text),
            pipeline: data.pipeline,
            project: data.project,
          },
      group:
        data.group === null
          ? null
          : {
              slug: data.group,
              title: data.groupTitle,
              step: data.step,
              status: GROUP_STATUS[event.kind] ?? null,
            },
      url: event.url,
      ...typed(event, limits),
      ...(truncated ? { truncated: true } : {}),
    },
  };
  return JSON.stringify(body);
}

/** The body of the request of an event: JSON, shortened until it fits, with `data.truncated` set. */
export function webhookBody(event: WebhookEvent): Uint8Array {
  let limits: Cut | null = null;
  let text = build(event, limits, false);
  for (
    let size = 100_000;
    Buffer.byteLength(text) > BODY_LIMIT && size >= 1;
    size = Math.floor(size / 2)
  ) {
    limits = { text: size, option: Math.max(Math.floor(size / 4), 1) };
    text = build(event, limits, true);
  }
  return new TextEncoder().encode(text);
}
