/**
 * Prompt engineering for the LLM (Figure 1, step 4).
 *
 * The scoped prompt reuses DirectGPT's text-prompt format
 * (src/model/prompts/TextPrompt.tsx): the selected span is replaced by a
 * <blank> marker inside its surrounding context, the original span is given
 * after "<blank>:", and the model is asked to "Rewrite <blank>. Follow
 * INSTRUCTION". The cleaning step is also adapted from DirectGPT's
 * cleanReplacement(): models sometimes echo "<blank>:" or "old -> new" and
 * may drop the whitespace around the span.
 */
import type { ChatMessage, ChatLLMRequest, ScopedLLMRequest } from './types';

export const SCOPED_SYSTEM_PROMPT = [
  'You are an AI writing assistant embedded in a collaborative document editor.',
  'A collaborator selected a span of the shared document; in the document it is shown as <blank>.',
  'Rewrite only <blank> following INSTRUCTION, so that it fits seamlessly with the surrounding text.',
  'Reply with the replacement text for <blank> only: no quotes, no labels, no explanations, no markdown.',
  'Keep the language of the original text.',
].join(' ');

export const CHAT_SYSTEM_PROMPT = [
  'You are a helpful AI writing assistant. Follow the user\'s instructions carefully.',
  'The user is co-writing a shared document with one or more collaborators. The full current document is given below between <document> tags.',
].join(' ');

/** Maximum context characters sent on each side of the selection. */
export const CONTEXT_CHARS = 1200;

/**
 * Surrounding context for a selection, trimmed to whole paragraphs when
 * possible so the model sees coherent text.
 */
export function extractContext(
  text: string,
  start: number,
  end: number,
  maxChars: number = CONTEXT_CHARS,
): { before: string; after: string } {
  let beforeStart = Math.max(0, start - maxChars);
  if (beforeStart > 0) {
    const para = text.indexOf('\n\n', beforeStart);
    if (para !== -1 && para < start) beforeStart = para + 2;
  }
  let afterEnd = Math.min(text.length, end + maxChars);
  if (afterEnd < text.length) {
    const para = text.lastIndexOf('\n\n', afterEnd);
    if (para !== -1 && para > end) afterEnd = para;
  }
  const before = (beforeStart > 0 ? '…' : '') + text.slice(beforeStart, start);
  const after = text.slice(end, afterEnd) + (afterEnd < text.length ? '…' : '');
  return { before, after };
}

export function buildScopedMessages(req: ScopedLLMRequest): ChatMessage[] {
  const variantNote =
    req.variant > 0
      ? `\n(This is alternative version #${req.variant + 1}; produce a different wording from previous versions.)`
      : '';
  const user = `${req.contextBefore}<blank>${req.contextAfter}
<blank>: ${req.selection}

INSTRUCTION: ${req.instruction}${variantNote}
Rewrite <blank>. Follow INSTRUCTION
<blank>:`;
  return [
    { role: 'system', content: SCOPED_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/** Longest document, selection, context or chat message the gateway accepts (the HTTP body is also capped at 2 MB). */
export const MAX_TEXT_CHARS = 200_000;
/** Longest AI instruction the gateway accepts. */
export const MAX_INSTRUCTION_CHARS = 4000;

/** Longest baseline chat history the gateway accepts (the client sends only the most recent turns). */
export const MAX_CHAT_MESSAGES = 200;

/**
 * The most recent `max` messages of a chat, starting with a user message, so a
 * very long baseline conversation keeps working instead of being rejected.
 */
export function recentChatMessages<M extends ChatMessage>(messages: M[], max: number = MAX_CHAT_MESSAGES): M[] {
  let start = Math.max(0, messages.length - max);
  while (start < messages.length && messages[start].role !== 'user') start++;
  return messages.slice(start);
}

export function buildChatMessages(req: ChatLLMRequest): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${CHAT_SYSTEM_PROMPT}\n\n<document>\n${req.document}\n</document>`,
    },
    ...req.messages.filter((m) => m.role !== 'system'),
  ];
}

/**
 * Clean a scoped LLM reply so it can replace the selected span directly.
 * Adapted from DirectGPT's TextPrompt.cleanReplacement().
 */
export function cleanScopedResult(original: string, result: string): string {
  let out = result.replace(/\r\n/g, '\n');
  // Strip a markdown code fence wrapping the whole answer.
  const fence = out.match(/^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  if (fence) out = fence[1];
  out = out.trim();
  if (out.startsWith('<blank>:')) out = out.slice('<blank>:'.length).trim();
  const trimmedOriginal = original.trim();
  if (trimmedOriginal && out.startsWith(trimmedOriginal + ' -> ')) {
    out = out.slice(trimmedOriginal.length + ' -> '.length).trim();
  }
  // Remove quotes wrapping the whole answer when the original was not quoted.
  const quotePairs: Array<[string, string]> = [['"', '"'], ['“', '”'], ["'", "'"]];
  for (const [open, close] of quotePairs) {
    if (
      out.length >= 2 &&
      out.startsWith(open) &&
      out.endsWith(close) &&
      !(trimmedOriginal.startsWith(open) && trimmedOriginal.endsWith(close))
    ) {
      out = out.slice(open.length, out.length - close.length).trim();
    }
  }
  // Restore the whitespace that surrounded the original selection.
  const spacesBefore = original.match(/^\s*/)?.[0] ?? '';
  const spacesAfter = original.match(/\s*$/)?.[0] ?? '';
  if (trimmedOriginal.length === 0) return original;
  return spacesBefore + out + spacesAfter;
}
