import { type Drafts, completeAnswers } from './drafts.ts';
import type { EventData, NotificationEventKind, QuestionData } from './events.ts';
import { DEFAULT_LIMITS, type RenderLimits, truncate } from './limits.ts';
import { type Closure, type Language, texts } from './texts.ts';

export interface ChatOption {
  /** 1-based. */
  index: number;
  text: string;
  recommended: boolean;
  selected: boolean;
}

export interface ChatQuestion {
  /** 1-based. */
  index: number;
  text: string;
  options: ChatOption[];
  recommendation: string | null;
  answer: string | null;
}

/** A button; `id` is opaque to the channel: `o:<question>:<option>`, `r`, `c`, `a` or `f`. */
export interface ChatAction {
  id: string;
  label: string;
}

export type ChatState = 'open' | 'answered' | 'closed';

/** A message as the core describes it; every channel draws it its own way. */
export interface ChatMessage {
  kind: NotificationEventKind;
  state: ChatState;
  headline: string;
  title: string;
  details: string[];
  link: string | null;
  /** Reason, summary or the question without structure. */
  body: string | null;
  questions: ChatQuestion[];
  /** One row per question with options, then the row of the general buttons. */
  rows: ChatAction[][];
  status: string | null;
  notice: string | null;
}

export interface RenderInput {
  kind: NotificationEventKind;
  run: string;
  data: EventData;
  drafts: Drafts;
  /** Set once the question is no longer open. */
  closure: Closure | null;
  /** The name of the connection the message is sent through. */
  channel: string;
  language: Language;
  publicUrl: string | null;
  limits?: RenderLimits;
}

/** A message the channel may draw again with tighter limits until it fits. */
export type Draw = (limits: RenderLimits) => ChatMessage;

export const ACCEPTED_REVIEW = 'Accepted.';

export function linkOf(publicUrl: string | null, run: string, group: string | null): string | null {
  if (publicUrl === null) return null;
  return `${publicUrl}/#runs/${run}${group === null ? '' : `/${group}`}`;
}

/** Whether a question has the structure the buttons need. */
export function structured(data: EventData): data is EventData & { questions: QuestionData[] } {
  return data.questions !== null && data.questions.length > 0;
}

function isReview(data: EventData): boolean {
  return data.humanOnly === 'review' && !structured(data);
}

function actionRows(
  data: EventData,
  questions: ChatQuestion[],
  open: boolean,
  language: Language,
): ChatAction[][] {
  if (!open) return [];
  const t = texts(language);
  if (isReview(data)) {
    return [
      [
        { id: 'a', label: t.accept },
        { id: 'f', label: t.rework },
      ],
    ];
  }
  const rows: ChatAction[][] = [];
  for (const question of questions) {
    if (question.options.length === 0) continue;
    rows.push(
      question.options.map((option) => ({ id: `o:${question.index}:${option.index}`, label: '' })),
    );
  }
  const general: ChatAction[] = [];
  if (questions.some((question) => question.recommendation !== null)) {
    general.push({ id: 'r', label: t.acceptRecommendations });
  }
  general.push({ id: 'c', label: t.customAnswer });
  rows.push(general);
  return rows;
}

function statusLine(input: RenderInput, questions: ChatQuestion[]): string | null {
  const t = texts(input.language);
  const { closure } = input;
  if (closure !== null) {
    return closure.by === 'channel' && closure.channel === input.channel
      ? t.answered(closure)
      : t.closure(closure);
  }
  if (questions.length < 1 || input.kind !== 'question') return null;
  const done = questions.filter((question) => question.answer !== null).length;
  return done === 0 ? null : t.progress(done, questions.length);
}

/** The message of an event: pure, so the same input always draws the same message. */
export function chatMessage(input: RenderInput): ChatMessage {
  const { data, kind, language } = input;
  const t = texts(language);
  const limits = input.limits ?? DEFAULT_LIMITS;
  let cut = false;
  const shorten = (text: string, max: number): string => {
    const result = truncate(text, max);
    cut ||= result.cut;
    return result.text;
  };
  const questions: ChatQuestion[] = (data.questions ?? []).map((question, at) => ({
    index: at + 1,
    text: shorten(question.text, limits.text),
    recommendation:
      question.recommendation === null ? null : shorten(question.recommendation, limits.option),
    answer:
      input.drafts[at] === null || input.drafts[at] === undefined
        ? null
        : shorten(input.drafts[at]!, limits.option),
    options: question.options.map((option, position) => ({
      index: position + 1,
      text: shorten(option, limits.option),
      recommended: question.recommendation === option,
      selected: input.drafts[at] === option,
    })),
  }));
  const open = input.closure === null;
  const complete = completeAnswers(questions.length, input.drafts) !== null;
  const details = [
    `${t.project}: ${data.project}`,
    `${t.pipeline}: ${data.pipeline}`,
    ...(data.group === null
      ? []
      : [`${t.group}: ${shorten(data.groupTitle ?? data.group, limits.detail)}`]),
    ...(data.step === null ? [] : [`${t.step}: ${data.step}`]),
  ];
  const headline =
    kind === 'question' && isReview(data)
      ? t.review
      : kind === 'question' && data.humanOnly === 'request'
        ? t.request
        : t.kinds[kind];
  const raw = bodyOf(input);
  const message: ChatMessage = {
    kind,
    state: open ? 'open' : input.closure?.by === 'channel' && complete ? 'answered' : 'closed',
    headline,
    title: `#${data.number}${data.title === '' ? '' : ` ${shorten(data.title, limits.detail)}`}`,
    details,
    link: linkOf(input.publicUrl, input.run, data.group),
    body: raw === null ? null : shorten(raw, limits.text),
    questions,
    rows: actionRows(data, questions, open && kind === 'question', language),
    status: statusLine(input, questions),
    notice: null,
  };
  return cut ? { ...message, notice: t.truncated } : message;
}

/** The text that is not a structured question: a reason, a summary, the outcome. */
function bodyOf(input: RenderInput): string | null {
  const { data, kind, language } = input;
  const t = texts(language);
  if (kind === 'finished') {
    return [
      data.outcome === null ? null : t.outcome[data.outcome],
      t.merged(data.merged, data.groups),
    ]
      .filter((part) => part !== null)
      .join(', ');
  }
  if (kind === 'question') {
    if (structured(data)) return null;
    return (
      [data.summary, data.question].filter((part) => part !== null && part !== '').join('\n\n') ||
      null
    );
  }
  return data.reason ?? data.summary;
}
