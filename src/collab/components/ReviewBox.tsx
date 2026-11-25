/**
 * Group review of one AI suggestion: teammates vote thumbs up/down and leave
 * short comments; everyone sees who voted (in their colour). The requester
 * sees the group's votes before deciding. All of it syncs through the room.
 */
import { useState } from 'react';
import type { ReviewEntry } from '../../../shared/types';
import { commentsFor, MAX_COMMENT_CHARS, myVote, tally, type ApprovalStatus } from '../../../shared/reviews';

interface Props {
  requestId: string;
  requesterId: string;
  requesterName: string;
  entries: ReviewEntry[];
  myId: string;
  approval: ApprovalStatus;
  /** False once the request is decided or while the AI is still working. */
  open: boolean;
  disabled: boolean;
  onVote: (value: 'up' | 'down' | 'none') => void;
  onComment: (text: string) => void;
}

export function approvalText(a: ApprovalStatus): string {
  if (a.teammates === 0) return 'Majority approval is required, but nobody else is online, so you can decide alone.';
  const base = `Majority approval required: ${a.up} of ${a.needed} thumbs-up needed (${a.teammates} teammate${a.teammates === 1 ? '' : 's'} online)`;
  return `${base}${a.met ? '. Approved by the group.' : '.'}`;
}

export function ReviewBox({ requestId, requesterId, requesterName, entries, myId, approval, open, disabled, onVote, onComment }: Props) {
  const [draft, setDraft] = useState('');
  const t = tally(entries, requestId, requesterId);
  const mine = myVote(entries, requestId, myId);
  const comments = commentsFor(entries, requestId);
  const isRequester = myId === requesterId;
  const canVote = open && !isRequester && !disabled;
  const send = () => {
    if (!draft.trim()) return;
    onComment(draft);
    setDraft('');
  };
  const voterChips = (list: ReviewEntry[], testId: string) => (
    <span className="cdg-voters" data-testid={testId}>
      {list.map((v) => (
        <span key={v.participantId} className="cdg-voter" title={`${v.name} voted ${v.value === 'up' ? 'thumbs-up' : 'thumbs-down'}`}>
          <span className="cdg-dot" style={{ background: v.color }} />
          {v.name}
        </span>
      ))}
    </span>
  );

  return (
    <div className="cdg-review" data-testid="review-box">
      <div className="cdg-review-votes">
        <button
          className={`cdg-btn cdg-btn-small cdg-vote ${mine === 'up' ? 'cdg-vote-on' : ''}`}
          data-testid="vote-up"
          aria-pressed={mine === 'up'}
          disabled={!canVote}
          title={isRequester ? 'Your teammates vote on your suggestion' : 'Thumbs-up: you think this change is good (click again to take it back)'}
          onClick={() => onVote(mine === 'up' ? 'none' : 'up')}
        >
          👍 <span data-testid="votes-up">{t.up.length}</span>
        </button>
        {voterChips(t.up, 'voters-up')}
        <button
          className={`cdg-btn cdg-btn-small cdg-vote ${mine === 'down' ? 'cdg-vote-on' : ''}`}
          data-testid="vote-down"
          aria-pressed={mine === 'down'}
          disabled={!canVote}
          title={isRequester ? 'Your teammates vote on your suggestion' : 'Thumbs-down: you do not want this change (click again to take it back)'}
          onClick={() => onVote(mine === 'down' ? 'none' : 'down')}
        >
          👎 <span data-testid="votes-down">{t.down.length}</span>
        </button>
        {voterChips(t.down, 'voters-down')}
      </div>
      {approval.required && (
        <div className={`cdg-approval ${approval.met ? 'cdg-approval-met' : ''}`} data-testid="approval-status" data-met={approval.met}>
          {approvalText(approval)}
        </div>
      )}
      {comments.length > 0 && (
        <ul className="cdg-comments" data-testid="comments">
          {comments.map((c) => (
            <li key={c.id} data-testid="comment">
              <span className="cdg-dot" style={{ background: c.color }} /> <strong>{c.participantId === myId ? 'You' : c.name}</strong>: {c.text}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="cdg-comment-form">
          <input
            className="cdg-input"
            data-testid="comment-input"
            aria-label={`Comment on ${isRequester ? 'your' : `${requesterName}'s`} suggestion`}
            placeholder="Add a short comment…"
            maxLength={MAX_COMMENT_CHARS}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="cdg-btn cdg-btn-small" data-testid="comment-send" disabled={disabled || !draft.trim()} onClick={send}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
