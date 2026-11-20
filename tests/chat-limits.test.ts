import { describe, expect, it } from 'vitest';
import { MAX_CHAT_MESSAGES, recentChatMessages } from '../shared/prompts';
import { validateCallBody } from '../server/llm';
import type { ChatMessage } from '../shared/types';

describe('recentChatMessages', () => {
  const chat = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
  it('keeps short chats unchanged', () => {
    expect(recentChatMessages(chat(5))).toEqual(chat(5));
  });
  it('keeps a long chat within the gateway limit, starting on a user message, ending with the newest', () => {
    const all = [...chat(301), { role: 'user' as const, content: 'latest' }].slice(0, 301);
    const recent = recentChatMessages(all);
    expect(recent.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGES);
    expect(recent[0].role).toBe('user');
    expect(recent[recent.length - 1]).toEqual(all[all.length - 1]);
    // The gateway accepts what the client sends.
    expect(() => validateCallBody({ provider: 'mock', request: { kind: 'chat', document: '', messages: recent } })).not.toThrow();
  });
});
