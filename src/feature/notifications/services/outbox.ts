import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { NotificationsPublishPort } from '../ports/index.ts';
import type {
  AnswerRepository,
  DeliveryOutcomes,
  DeliveryRepository,
} from '../repositories/index.ts';

import type { NotificationChannels } from './channels.ts';
import type { ChannelFactories } from './factories.ts';
import type { SubscriptionService } from './subscriptions.ts';

/** What the sending and the closing of messages work with. */
export interface OutboxDependencies {
  subscriptions: SubscriptionService;
  deliveries: DeliveryRepository;
  outcomes: DeliveryOutcomes;
  answers: AnswerRepository;
  channels: NotificationChannels;
  factories: ChannelFactories;
  config: ConfigService;
  publish: NotificationsPublishPort;
  log: (message: string) => void;
  now: () => number;
}
