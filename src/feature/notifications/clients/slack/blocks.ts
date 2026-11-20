import {
  DEFAULT_LIMITS,
  texts,
  tighten,
  truncate,
  type ChatAction,
  type ChatMessage,
  type ChatOption,
  type ChatQuestion,
  type Draw,
  type Language,
} from '../../types/index.ts';

/** The most the text of a section may hold in Block Kit. */
export const SECTION_LIMIT = 3000;
/** The most the label of a button or an option may hold. */
export const LABEL_LIMIT = 75;
/** The most a message may have in blocks. */
export const BLOCK_LIMIT = 50;
/** The most variants shown as buttons; more of them become a drop-down list. */
export const BUTTONS_LIMIT = 5;
const HEADER_LIMIT = 150;
const CONTEXT_ELEMENTS = 10;

export type Block = Record<string, unknown>;

export interface Rendered {
  /** The plain text Slack shows in notifications and where blocks are not drawn. */
  text: string;
  blocks: Block[];
}

/** mrkdwn gives meaning to `&`, `<` and `>`: they are the only characters to escape. */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const plain = (text: string, max: number) => ({
  type: 'plain_text',
  text: truncate(text, max).text,
  emoji: true,
});
const mrkdwn = (text: string) => ({ type: 'mrkdwn', text });

function optionLabel(question: ChatQuestion, option: ChatOption): string {
  return `${option.recommended ? '⭐ ' : ''}${option.selected ? '✅ ' : ''}${question.index}.${option.index} ${option.text}`;
}

/** The text of a question: the number, the text, every option with its marks, the state. */
function questionText(question: ChatQuestion, language: Language): string {
  const t = texts(language);
  const lines: string[] = [`*${question.index}.* ${escapeMrkdwn(question.text)}`];
  for (const option of question.options) {
    const marks = `${option.recommended ? '⭐' : ''}${option.selected ? '✅' : ''}`;
    lines.push(
      `${question.index}.${option.index} ${escapeMrkdwn(option.text)}${marks === '' ? '' : ` ${marks}`}`,
    );
  }
  if (question.options.length === 0 && question.recommendation !== null) {
    lines.push(`⭐ ${escapeMrkdwn(t.recommended)}: ${escapeMrkdwn(question.recommendation)}`);
  }
  lines.push(
    question.answer === null
      ? `_${escapeMrkdwn(t.waiting)}_`
      : `→ *${escapeMrkdwn(question.answer)}*`,
  );
  return lines.join('\n');
}

/** A link of mrkdwn: the address must not contain what ends it. */
function linkText(url: string, label: string): string {
  const safe = url.replace(/[<>| ]/g, (char) => encodeURIComponent(char));
  return `<${safe}|${escapeMrkdwn(label)}>`;
}

/**
 * The elements of the row of one question. Up to five variants are buttons, more are one list. The
 * ids are unique in the message: the key of the delivery, the question and the variant.
 */
function questionElements(
  question: ChatQuestion,
  actions: ChatAction[],
  shortKey: string,
  language: Language,
): Block[] {
  const t = texts(language);
  if (actions.length <= BUTTONS_LIMIT) {
    return actions.map((action) => {
      const chosen = question.options.find(
        (option) => `o:${question.index}:${option.index}` === action.id,
      );
      const id = `${shortKey}:${action.id}`;
      return {
        type: 'button',
        text: plain(
          chosen === undefined ? action.label : optionLabel(question, chosen),
          LABEL_LIMIT,
        ),
        action_id: id,
        value: id,
      };
    });
  }
  return [
    {
      type: 'static_select',
      action_id: `${shortKey}:o:${question.index}`,
      placeholder: plain(`${question.index}. ${t.question}`, LABEL_LIMIT),
      options: question.options.map((option) => ({
        text: plain(optionLabel(question, option), LABEL_LIMIT),
        value: String(option.index),
      })),
    },
  ];
}

interface Parts {
  /** The header, the details, the body. */
  lead: Block[];
  /** A section and its buttons: kept or dropped together. */
  groups: Block[][];
  /** The general buttons and the state: always kept. */
  tail: Block[];
}

function compose(message: ChatMessage, shortKey: string, language: Language): Parts {
  const t = texts(language);
  const lead: Block[] = [
    {
      type: 'header',
      block_id: `${shortKey}:h`,
      text: plain(`${message.headline} ${message.title}`, HEADER_LIMIT),
    },
  ];
  const details = message.details.map((line) => mrkdwn(escapeMrkdwn(line)));
  if (message.link !== null) details.push(mrkdwn(linkText(message.link, t.openLink)));
  if (details.length > 0) {
    lead.push({
      type: 'context',
      block_id: `${shortKey}:x`,
      elements: details.slice(0, CONTEXT_ELEMENTS),
    });
  }
  if (message.body !== null) {
    lead.push({
      type: 'section',
      block_id: `${shortKey}:b`,
      text: mrkdwn(escapeMrkdwn(message.body)),
    });
  }

  // The rows of the core: one per question with options, then the general row.
  const byQuestion = new Map<number, ChatAction[]>();
  let general: ChatAction[] = [];
  for (const row of message.rows) {
    const [, number] = row[0]?.id.split(':') ?? [];
    if (row[0]?.id.startsWith('o:') && number !== undefined) byQuestion.set(Number(number), row);
    else general = row;
  }
  const groups: Block[][] = message.questions.map((question) => {
    const group: Block[] = [
      {
        type: 'section',
        block_id: `${shortKey}:q:${question.index}`,
        text: mrkdwn(questionText(question, language)),
      },
    ];
    const row = byQuestion.get(question.index);
    if (row !== undefined && row.length > 0) {
      group.push({
        type: 'actions',
        block_id: `${shortKey}:a:${question.index}`,
        elements: questionElements(question, row, shortKey, language),
      });
    }
    return group;
  });

  const tail: Block[] = [];
  if (general.length > 0) {
    tail.push({
      type: 'actions',
      block_id: `${shortKey}:s`,
      elements: general.map((action) => ({
        type: 'button',
        text: plain(action.label, LABEL_LIMIT),
        action_id: `${shortKey}:${action.id}`,
        value: `${shortKey}:${action.id}`,
      })),
    });
  }
  const notes = [message.status, message.notice]
    .filter((line): line is string => line !== null)
    .map((line) => mrkdwn(`_${escapeMrkdwn(line)}_`));
  if (notes.length > 0) tail.push({ type: 'context', block_id: `${shortKey}:t`, elements: notes });
  return { lead, groups, tail };
}

function assemble({ lead, groups, tail }: Parts, message: ChatMessage): Rendered {
  const blocks = [...lead];
  let room = BLOCK_LIMIT - lead.length - tail.length;
  for (const group of groups) {
    if (group.length > room) break;
    blocks.push(...group);
    room -= group.length;
  }
  blocks.push(...tail);
  return { text: escapeMrkdwn(`${message.headline} ${message.title}`), blocks };
}

function longestSection(blocks: Block[]): number {
  return Math.max(
    0,
    ...blocks.map((block) =>
      block.type === 'section' ? [...(block.text as { text: string }).text].length : 0,
    ),
  );
}

/** The message drawn again with tighter limits until every text fits in Block Kit. */
export function renderMessage(draw: Draw, shortKey: string, language: Language): Rendered {
  let limits = DEFAULT_LIMITS;
  for (;;) {
    const message = draw(limits);
    const rendered = assemble(compose(message, shortKey, language), message);
    if (longestSection(rendered.blocks) <= SECTION_LIMIT) return rendered;
    const next = tighten(limits);
    if (next === null) {
      // Nothing is left to cut but the text itself: it is cut where it still is too long.
      return {
        ...rendered,
        blocks: rendered.blocks.map((block) =>
          block.type === 'section'
            ? {
                ...block,
                text: mrkdwn(truncate((block.text as { text: string }).text, SECTION_LIMIT).text),
              }
            : block,
        ),
      };
    }
    limits = next;
  }
}
