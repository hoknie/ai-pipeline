import type { NotificationEventKind } from './events.ts';

export type Language = 'en' | 'ru';
export const LANGUAGES: readonly Language[] = ['en', 'ru'];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/** Who closed a question. */
export type Closure =
  | { by: 'human' | 'autopilot' | 'observer' | 'cancelled' | 'other' }
  | { by: 'channel'; channel: string; user: string };

export interface Texts {
  kinds: Record<NotificationEventKind, string>;
  review: string;
  request: string;
  project: string;
  pipeline: string;
  group: string;
  step: string;
  question: string;
  recommended: string;
  waiting: string;
  answer: string;
  acceptRecommendations: string;
  customAnswer: string;
  accept: string;
  rework: string;
  openLink: string;
  truncated: string;
  merged: (merged: number, total: number) => string;
  outcome: Record<'finished' | 'failed' | 'cancelled', string>;
  progress: (done: number, total: number) => string;
  closure: (closure: Closure) => string;
  answered: (closure: Closure) => string;
  replyPrompt: (questions: number) => string;
  formatHint: string;
  test: string;
  who: (chat: string, user: string) => string;
  results: Record<'selected' | 'sent' | 'forbidden' | 'closed' | 'format' | 'waiting', string>;
}

const en: Texts = {
  kinds: {
    question: 'Question',
    failed: 'Group failed',
    conflict: 'Merge conflict',
    delivery: 'Delivery failed',
    finished: 'Task finished',
  },
  review: 'Step review',
  request: 'Request for a person',
  project: 'Project',
  pipeline: 'Pipeline',
  group: 'Group',
  step: 'Step',
  question: 'Question',
  recommended: 'recommended',
  waiting: 'waiting for an answer',
  answer: 'Answer',
  acceptRecommendations: 'Accept recommendations',
  customAnswer: 'Custom answer',
  accept: 'Accept',
  rework: 'Rework',
  openLink: 'Open the task',
  truncated: 'The text is shortened.',
  merged: (merged, total) => `${merged} of ${total} groups merged`,
  outcome: { finished: 'finished', failed: 'failed', cancelled: 'cancelled' },
  progress: (done, total) => `Answered ${done} of ${total}`,
  closure: (closure) => {
    switch (closure.by) {
      case 'human':
        return 'Closed: answered by a person outside the bot';
      case 'autopilot':
        return 'Closed: answered by the autopilot';
      case 'observer':
        return 'Closed: answered by an observer';
      case 'cancelled':
        return 'Closed: the group was cancelled';
      case 'channel':
        return `Closed: answered via ${closure.channel} by user ${closure.user}`;
      default:
        return 'Closed: the question is no longer open';
    }
  },
  answered: (closure) =>
    closure.by === 'channel'
      ? `Answer sent via ${closure.channel} by user ${closure.user}`
      : 'Answer sent',
  replyPrompt: (questions) =>
    questions > 1
      ? 'Reply to this message with your answer as `N: text` (N is the question number).'
      : 'Reply to this message with your answer.',
  formatHint: 'Start every answer with the question number: `N: text`.',
  test: 'Test message from aip: the channel works.',
  who: (chat, user) => `Chat id: ${chat}\nYour user id: ${user}`,
  results: {
    selected: 'Selected',
    sent: 'Answer sent',
    forbidden: 'You are not allowed to answer',
    closed: 'The question is already closed',
    format: 'Use the format N: text',
    waiting: 'Waiting for the other answers',
  },
};

const ru: Texts = {
  kinds: {
    question: 'Вопрос',
    failed: 'Группа упала',
    conflict: 'Конфликт слияния',
    delivery: 'Сбой доставки',
    finished: 'Задача завершена',
  },
  review: 'Ревью шага',
  request: 'Просьба к человеку',
  project: 'Проект',
  pipeline: 'Pipeline',
  group: 'Группа',
  step: 'Шаг',
  question: 'Вопрос',
  recommended: 'рекомендация',
  waiting: 'ждёт ответа',
  answer: 'Ответ',
  acceptRecommendations: 'Принять рекомендации',
  customAnswer: 'Свой ответ',
  accept: 'Принять',
  rework: 'Доработать',
  openLink: 'Открыть задачу',
  truncated: 'Текст сокращён.',
  merged: (merged, total) => `слито групп: ${merged} из ${total}`,
  outcome: { finished: 'завершена', failed: 'упала', cancelled: 'отменена' },
  progress: (done, total) => `Отвечено ${done} из ${total}`,
  closure: (closure) => {
    switch (closure.by) {
      case 'human':
        return 'Закрыто: ответил человек вне бота';
      case 'autopilot':
        return 'Закрыто: ответил автопилот';
      case 'observer':
        return 'Закрыто: ответил наблюдатель';
      case 'cancelled':
        return 'Закрыто: группа отменена';
      case 'channel':
        return `Закрыто: ответ через ${closure.channel}, пользователь ${closure.user}`;
      default:
        return 'Закрыто: вопрос больше не открыт';
    }
  },
  answered: (closure) =>
    closure.by === 'channel'
      ? `Ответ отправлен через ${closure.channel}, пользователь ${closure.user}`
      : 'Ответ отправлен',
  replyPrompt: (questions) =>
    questions > 1
      ? 'Ответьте на это сообщение: `N: текст`, где N — номер вопроса.'
      : 'Ответьте на это сообщение своим ответом.',
  formatHint: 'Начните каждый ответ с номера вопроса: `N: текст`.',
  test: 'Проверочное сообщение aip: канал работает.',
  who: (chat, user) => `Id чата: ${chat}\nВаш id пользователя: ${user}`,
  results: {
    selected: 'Выбрано',
    sent: 'Ответ отправлен',
    forbidden: 'Нет прав отвечать',
    closed: 'Вопрос уже закрыт',
    format: 'Формат ответа: N: текст',
    waiting: 'Ждём остальные ответы',
  },
};

export function texts(language: Language): Texts {
  return language === 'ru' ? ru : en;
}
