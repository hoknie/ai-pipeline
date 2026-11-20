import { isRejected } from '../../../platform/errors/index.ts';
import type { IntegrationsServices } from '../../integrations/services/index.ts';
import { currentPermissions, type RunsServices } from '../../runs/services/index.ts';
import { answersText } from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { NotificationsPublishPort } from '../ports/index.ts';
import type {
  AnswerRepository,
  DeliveryOutcomes,
  DeliveryRepository,
} from '../repositories/index.ts';
import {
  ACCEPTED_REVIEW,
  acceptRecommendations,
  completeAnswers,
  draftsOf,
  type Drafts,
  encodeClosure,
  notificationEvents,
  parseTextAnswer,
  selectOption,
  structured,
  type Delivery,
  type InboundInput,
  type InboundResult,
  type QuestionData,
} from '../types/index.ts';

import type { NotificationChannels, OpenChannel } from './channels.ts';
import { drawOf, publicUrlOf } from './drawing.ts';
import type { ChannelFactories } from './factories.ts';
import type { SubscriptionService } from './subscriptions.ts';

export interface InboundDependencies {
  integrations: IntegrationsServices;
  subscriptions: SubscriptionService;
  deliveries: DeliveryRepository;
  outcomes: DeliveryOutcomes;
  answers: AnswerRepository;
  channels: NotificationChannels;
  factories: ChannelFactories;
  runs: RunsServices;
  config: ConfigService;
  publish: NotificationsPublishPort;
  log: (message: string) => void;
  now: () => number;
}

const closed: InboundResult = { kind: 'closed' };
const ignored: InboundResult = { kind: 'ignored' };

/** What was asked of an open question: one answer of the user, in the shape the question needs. */
type Step =
  | { kind: 'answer'; text: string }
  | {
      kind: 'fill';
      fill: (questions: QuestionData[], drafts: Drafts) => Drafts;
      /** What the user is told while answers are still missing. */
      incomplete: 'selected' | 'waiting';
    }
  | { kind: 'prompt' };

/**
 * What people do in a chat, turned into the answer of a question: only in the chat and by the users
 * the connection allows, one claim per event of the channel, drafts until every question has an
 * answer, then the same `answer` event the panel sends.
 */
export class NotificationInbound {
  private readonly dependencies: InboundDependencies;

  constructor(dependencies: InboundDependencies) {
    this.dependencies = dependencies;
  }

  async handle(connectionId: string, input: InboundInput): Promise<InboundResult> {
    const { integrations, deliveries, subscriptions } = this.dependencies;
    // Who may act comes first: nothing of the delivery is read for anyone else.
    const opened = this.dependencies.channels.open(connectionId);
    if (opened === null) return ignored;
    const factory = this.dependencies.factories.get(opened.connection.kind);
    if (!factory?.allows(opened.connection.params, input.chat, input.user)) {
      return { kind: 'forbidden' };
    }
    if (!integrations.inbound.claimEvent(connectionId, input.event)) return ignored;
    const delivery =
      input.type === 'action'
        ? deliveries.findByShortKey(input.shortKey)
        : this.target(connectionId, input);
    const owner = delivery && subscriptions.all().find((one) => one.id === delivery.subscriptionId);
    if (delivery === undefined || owner?.connectionId !== connectionId) {
      return input.type === 'action' ? closed : ignored;
    }
    if (delivery.kind !== 'question') return ignored;
    if (delivery.state !== 'sent') return closed;
    const step =
      input.type === 'action'
        ? this.stepOf(delivery, input.action)
        : this.textStep(delivery, input.text);
    if (step === null) return input.type === 'action' ? ignored : { kind: 'format' };
    if (step.kind === 'prompt') {
      return {
        kind: 'prompt',
        shortKey: delivery.shortKey,
        questions: delivery.payload.questions?.length ?? 0,
      };
    }
    const result = await this.apply(delivery, step, input.user, opened);
    if (result.kind === 'selected' || result.kind === 'waiting')
      await this.redraw(delivery, opened);
    return result;
  }

  private target(connectionId: string, input: Extract<InboundInput, { type: 'text' }>) {
    const { deliveries } = this.dependencies;
    if (input.target.shortKey !== null) return deliveries.findByShortKey(input.target.shortKey);
    return input.target.message === null
      ? undefined
      : deliveries.findByMessage(connectionId, input.target.message);
  }

  /** The step a button asks for; null for an action the question does not have. */
  private stepOf(delivery: Delivery, action: string): Step | null {
    const data = delivery.payload;
    const [code, question, option] = action.split(':');
    if (code === 'c' || code === 'f') return { kind: 'prompt' };
    if (code === 'a') {
      return data.humanOnly === 'review' && !structured(data)
        ? { kind: 'answer', text: ACCEPTED_REVIEW }
        : null;
    }
    if (code === 'r')
      return structured(data)
        ? { kind: 'fill', fill: acceptRecommendations, incomplete: 'waiting' }
        : null;
    if (code === 'o' && structured(data)) {
      const [at, chosen] = [Number(question) - 1, Number(option) - 1];
      const text = data.questions[at]?.options[chosen];
      return text === undefined
        ? null
        : {
            kind: 'fill',
            incomplete: 'selected',
            fill: (_questions, drafts) => drafts.map((one, index) => (index === at ? text : one)),
          };
    }
    return null;
  }

  /** What a text answers; null when it does not parse as an answer to these questions. */
  private textStep(delivery: Delivery, text: string): Step | null {
    const data = delivery.payload;
    const count = structured(data) ? data.questions.length : 0;
    const parsed = parseTextAnswer(text, count);
    if (!parsed.ok) return null;
    if (!structured(data)) return { kind: 'answer', text: parsed.answers[0]!.text };
    return {
      kind: 'fill',
      incomplete: 'selected',
      fill: (_questions, drafts) =>
        drafts.map(
          (one, index) => parsed.answers.find((answer) => answer.index === index)?.text ?? one,
        ),
    };
  }

  /** Applies a step to a question that is still open, inside the queue of changes of the runs. */
  private apply(
    delivery: Delivery,
    step: Exclude<Step, { kind: 'prompt' }>,
    user: string,
    opened: OpenChannel,
  ): Promise<InboundResult> {
    const { runs, answers, deliveries, outcomes, config, now } = this.dependencies;
    return runs.engine.serial(async () => {
      const state = runs.states.lookup(delivery.run);
      const current = deliveries.find(delivery.id);
      const open =
        state !== undefined &&
        current?.state === 'sent' &&
        notificationEvents(state).some((event) => event.key === delivery.eventKey);
      if (!open || delivery.group === null) return closed;
      const questions = delivery.payload.questions ?? [];
      let answer: string;
      if (step.kind === 'answer') {
        answer = step.text;
      } else {
        const drafts = step.fill(questions, [
          ...draftsOf(questions.length, answers.all(delivery.id)),
        ]);
        for (const [index, text] of drafts.entries()) {
          if (text !== null) answers.set(delivery.id, index, text, user, now());
        }
        const complete = completeAnswers(questions.length, drafts);
        if (complete === null) return { kind: step.incomplete } as const;
        answer = answersText(questions, complete);
      }
      outcomes.setClosedBy(
        delivery.id,
        encodeClosure({ by: 'channel', channel: opened.connection.name, user }),
        now(),
      );
      try {
        await runs.engine.apply(state, {
          kind: 'answer',
          group: delivery.group,
          answer,
          by: 'human',
          permissions: currentPermissions(config, state),
        });
      } catch (error) {
        outcomes.setClosedBy(delivery.id, '', now());
        if (isRejected(error)) return closed;
        throw error;
      }
      return { kind: 'sent' } as const;
    });
  }

  /** Draws the message again with the answers collected so far. */
  private async redraw(delivery: Delivery, opened: OpenChannel): Promise<void> {
    const { deliveries, answers, config, log } = this.dependencies;
    const current = deliveries.find(delivery.id);
    if (current?.external == null) return;
    try {
      await opened.channel.update(
        current.external,
        drawOf(current, answers.all(current.id), null, opened, publicUrlOf(config)),
        current.shortKey,
      );
    } catch (error) {
      log(`notifications: cannot redraw the message of delivery ${current.id}: ${String(error)}`);
    }
  }
}
