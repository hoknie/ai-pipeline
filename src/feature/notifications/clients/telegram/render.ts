import {
  DEFAULT_LIMITS,
  texts,
  tighten,
  truncate,
  type ChatMessage,
  type ChatOption,
  type ChatQuestion,
  type Draw,
  type Language,
} from '../../types/index.ts';

/** The most a message may hold in Telegram. */
export const TEXT_LIMIT = 4096;
/** The most the data of a button may hold, in bytes. */
export const CALLBACK_LIMIT = 64;
const LABEL_LIMIT = 36;

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface Rendered {
  text: string;
  keyboard: InlineButton[][];
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function compose(message: ChatMessage, shortKey: string, language: Language): Rendered {
  const t = texts(language);
  const lines: string[] = [`<b>${escapeHtml(message.headline)}</b> ${escapeHtml(message.title)}`];
  lines.push(...message.details.map(escapeHtml));
  if (message.link !== null) {
    lines.push(`<a href="${escapeHtml(message.link)}">${escapeHtml(t.openLink)}</a>`);
  }
  if (message.body !== null) lines.push('', escapeHtml(message.body));
  for (const question of message.questions) {
    lines.push('', `<b>${question.index}.</b> ${escapeHtml(question.text)}`);
    for (const option of question.options) {
      const marks = `${option.recommended ? '⭐' : ''}${option.selected ? '✅' : ''}`;
      lines.push(
        `${question.index}.${option.index} ${escapeHtml(option.text)}${marks === '' ? '' : ` ${marks}`}`,
      );
    }
    if (question.options.length === 0 && question.recommendation !== null) {
      lines.push(`⭐ ${escapeHtml(t.recommended)}: ${escapeHtml(question.recommendation)}`);
    }
    lines.push(
      question.answer === null
        ? `<i>${escapeHtml(t.waiting)}</i>`
        : `→ <b>${escapeHtml(question.answer)}</b>`,
    );
  }
  if (message.status !== null) lines.push('', `<i>${escapeHtml(message.status)}</i>`);
  if (message.notice !== null) lines.push(`<i>${escapeHtml(message.notice)}</i>`);
  return { text: lines.join('\n'), keyboard: buttons(message, shortKey) };
}

/** A button of an option shows `<question>.<option> <text>`, shortened; its data names no text. */
function buttons(message: ChatMessage, shortKey: string): InlineButton[][] {
  const byId = new Map<string, { question: ChatQuestion; option: ChatOption }>(
    message.questions.flatMap((question) =>
      question.options.map(
        (option) => [`o:${question.index}:${option.index}`, { question, option }] as const,
      ),
    ),
  );
  return message.rows.map((row) =>
    row.map((action) => {
      const chosen = byId.get(action.id);
      const label =
        chosen === undefined
          ? action.label
          : `${chosen.option.recommended ? '⭐ ' : ''}${chosen.option.selected ? '✅ ' : ''}${chosen.question.index}.${chosen.option.index} ${truncate(chosen.option.text, LABEL_LIMIT).text}`;
      const data = `${shortKey}:${action.id}`;
      if (Buffer.byteLength(data) > CALLBACK_LIMIT) throw new Error('callback data is too long');
      return { text: label, callback_data: data };
    }),
  );
}

/** The message drawn again with tighter limits until it fits in Telegram; every option stays. */
export function renderMessage(draw: Draw, shortKey: string, language: Language): Rendered {
  let limits = DEFAULT_LIMITS;
  for (;;) {
    const rendered = compose(draw(limits), shortKey, language);
    if (rendered.text.length <= TEXT_LIMIT) return rendered;
    const next = tighten(limits);
    if (next === null) {
      // Nothing is left to cut but the whole: the end is dropped, the buttons stay.
      const cut = rendered.text.slice(0, TEXT_LIMIT - 2);
      return { ...rendered, text: `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0))}\n…` };
    }
    limits = next;
  }
}
