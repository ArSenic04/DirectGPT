/**
 * Baseline condition: conventional prompt-based AI editing. A private chat
 * with the assistant, which always receives the whole current document; there
 * is no selection scoping, preview or attribution. Results are moved into the
 * document by copy and paste, like with a separate ChatGPT window.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, LLMProviderId } from '../../../shared/types';
import { MockBadge } from './StatusBadge';

export interface ChatEntry extends ChatMessage {
  provider?: LLMProviderId;
  error?: boolean;
}

interface Props {
  messages: ChatEntry[];
  busy: boolean;
  enabled: boolean;
  disabledReason: string | null;
  onSend: (text: string) => void;
  onCopy: (index: number) => void;
  copiedIndex: number | null;
}

export function ChatPanel({ messages, busy, enabled, disabledReason, onSend, onCopy, copiedIndex }: Props) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, busy]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !enabled) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div className="cdg-chat" data-testid="chat-panel">
      <div className="cdg-chat-note">
        AI assistant (chat). It can read the <strong>entire document</strong>. Describe what to change, then copy the answer into the document yourself.
      </div>
      {disabledReason && <div className="cdg-muted cdg-small cdg-pad">{disabledReason}</div>}
      <div className="cdg-chat-list" ref={listRef}>
        {messages.length === 0 && <div className="cdg-empty">Ask the assistant to revise part of the document, e.g. “Shorten the second paragraph”.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`cdg-msg cdg-msg-${m.role} ${m.error ? 'cdg-msg-error' : ''}`} data-testid={`chat-${m.role}`}>
            <div className="cdg-msg-head">
              {m.role === 'user' ? 'You' : 'Assistant'}
              {m.provider === 'mock' && <MockBadge />}
            </div>
            <div className="cdg-msg-body">{m.content}</div>
            {m.role === 'assistant' && !m.error && (
              <button className="cdg-btn cdg-btn-small" data-testid="copy-response" onClick={() => onCopy(i)}>
                {copiedIndex === i ? 'Copied ✓' : 'Copy'}
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="cdg-msg cdg-msg-assistant" data-testid="chat-busy">
            <span className="cdg-spinner" /> Thinking…
          </div>
        )}
      </div>
      <div className="cdg-chat-input">
        <textarea
          className="cdg-input"
          rows={3}
          placeholder="Message the assistant…"
          value={draft}
          disabled={!enabled}
          data-testid="chat-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="cdg-btn cdg-btn-primary" disabled={!enabled || busy || !draft.trim()} data-testid="chat-send" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
