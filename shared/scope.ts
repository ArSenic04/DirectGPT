/**
 * Selection-scope helpers (Figure 1, step 2: "a sentence, paragraph, or
 * section defines the editing scope").
 */
import type { ScopeKind } from './types';

export interface Range {
  from: number;
  to: number;
}

const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s|$)/g;

/** Paragraph boundaries (paragraphs are separated by blank lines). */
export function paragraphRangeAt(text: string, pos: number): Range {
  const p = Math.max(0, Math.min(pos, text.length));
  const before = text.lastIndexOf('\n\n', p - 1);
  let from = before === -1 ? 0 : before + 2;
  const after = text.indexOf('\n\n', p);
  let to = after === -1 ? text.length : after;
  // Do not include leading/trailing whitespace of the paragraph.
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return { from, to };
}

/** Sentence boundaries around a position, never crossing a paragraph. */
export function sentenceRangeAt(text: string, pos: number): Range {
  const para = paragraphRangeAt(text, pos);
  const paraText = text.slice(para.from, para.to);
  const local = Math.max(0, Math.min(pos - para.from, paraText.length));
  let start = 0;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(paraText)) !== null) {
    const endOfSentence = m.index + m[0].length;
    if (endOfSentence > local || (endOfSentence === local && local === paraText.length)) {
      let from = start;
      while (from < endOfSentence && /\s/.test(paraText[from])) from++;
      return { from: para.from + from, to: para.from + endOfSentence };
    }
    start = endOfSentence;
  }
  let from = start;
  while (from < paraText.length && /\s/.test(paraText[from])) from++;
  return { from: para.from + from, to: para.to };
}

/** Expand a range to cover whole sentences. */
export function expandToSentences(text: string, range: Range): Range {
  const a = sentenceRangeAt(text, range.from);
  const b = sentenceRangeAt(text, Math.max(range.from, range.to - 1));
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
}

/** Expand a range to cover whole paragraphs. */
export function expandToParagraphs(text: string, range: Range): Range {
  const a = paragraphRangeAt(text, range.from);
  const b = paragraphRangeAt(text, Math.max(range.from, range.to - 1));
  return { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
}

/** Classify what kind of unit a selection covers, for attribution and logs. */
export function classifyScope(text: string, range: Range): ScopeKind {
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const trimmedDoc = text.trim();
  const selected = text.slice(from, to).trim();
  if (selected.length === 0) return 'span';
  if (selected === trimmedDoc) return 'document';
  if (selected.includes('\n\n')) return 'section';
  const para = paragraphRangeAt(text, from);
  if (para.from >= from && para.to <= to) return 'paragraph';
  const sent = expandToSentences(text, { from, to });
  if (sent.from >= from - 1 && sent.to <= to + 1) return 'sentence';
  return 'span';
}
