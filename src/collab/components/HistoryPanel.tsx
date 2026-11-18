/**
 * Shared edit history and attribution (Figure 1, step 8): who requested
 * what, what changed, its status and timestamps, with revert of accepted
 * AI edits.
 */
import { useState } from 'react';
import type { AIRequestRecord, RequestStatus } from '../../../shared/types';
import { DiffView } from './DiffView';
import { MockBadge, StatusBadge, formatTime } from './StatusBadge';

interface Props {
  requests: AIRequestRecord[];
  myId: string;
  nameOf: (participantId: string) => string;
  onRevert: (id: string, force?: boolean) => void;
  onFocus: (id: string) => void;
  revertConflicts: Record<string, string>;
  disabled: boolean;
}

const FILTERS: Array<{ id: 'all' | RequestStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'pending', label: 'Pending' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'conflicted', label: 'Conflict' },
  { id: 'reverted', label: 'Reverted' },
];

export function HistoryPanel({ requests, myId, nameOf, onRevert, onFocus, revertConflicts, disabled }: Props) {
  const [filter, setFilter] = useState<'all' | RequestStatus>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = [...requests].reverse().filter((r) => filter === 'all' || r.status === filter || (filter === 'pending' && r.status === 'generating'));

  return (
    <div className="cdg-history" data-testid="history-panel">
      <div className="cdg-filters" role="tablist" aria-label="Filter history">
        {FILTERS.map((f) => (
          <button key={f.id} className={`cdg-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {list.length === 0 && <div className="cdg-empty">No AI edits yet.</div>}
      {list.map((r) => {
        const version = r.applied ? { text: r.applied.text } : r.versions[r.activeVersion];
        const isOpen = open[r.id] ?? false;
        return (
          <div key={r.id} className="cdg-history-item" data-testid="history-item" data-request-id={r.id} data-status={r.status}>
            <button className="cdg-history-summary" onClick={() => setOpen({ ...open, [r.id]: !isOpen })} aria-expanded={isOpen}>
              <span className="cdg-dot" style={{ background: r.requester.color }} />
              <span className="cdg-history-who" data-testid="history-requester">{r.requester.participantId === myId ? `${r.requester.name} (you)` : r.requester.name}</span>
              <span className="cdg-history-what">
                {r.commandId === 'custom' || r.commandId.startsWith('saved:') ? `“${r.instruction}”` : r.commandLabel}
                <span className="cdg-muted"> · {r.scope}</span>
              </span>
              <StatusBadge status={r.status} />
            </button>
            <div className="cdg-history-meta">
              Requested {formatTime(r.createdAt)}
              {r.decidedAt !== undefined && <> · {r.status === 'rejected' ? 'rejected' : 'accepted'} by {nameOf(r.decidedBy ?? '')} at {formatTime(r.decidedAt)}</>}
              {r.applied?.conflictOverride && <> · <strong>applied over a conflict</strong></>}
              {r.revertedAt !== undefined && <> · reverted by {nameOf(r.revertedBy ?? '')} at {formatTime(r.revertedAt)}</>}
              {r.versions.length > 1 && <> · {r.versions.length} versions</>}
              {r.versions[0]?.provider === 'mock' && <> <MockBadge /></>}
            </div>
            {isOpen && (
              <div className="cdg-history-body">
                {version ? <DiffView before={r.applied ? r.applied.beforeText : r.originalText} after={version.text} /> : <div className="cdg-muted">No suggestion was produced.</div>}
                {r.error && <div className="cdg-error">{r.error}</div>}
              </div>
            )}
            <div className="cdg-history-actions">
              <button className="cdg-btn cdg-btn-ghost cdg-btn-small" onClick={() => onFocus(r.id)}>Show in document</button>
              {r.status === 'accepted' && (
                <button className="cdg-btn cdg-btn-small" data-testid="revert" disabled={disabled} onClick={() => onRevert(r.id)}>
                  ↶ Revert
                </button>
              )}
              {r.status === 'accepted' && revertConflicts[r.id] && (
                <span className="cdg-conflict-inline" role="alert">
                  {revertConflicts[r.id]}{' '}
                  <button className="cdg-btn cdg-btn-warn cdg-btn-small" data-testid="revert-anyway" disabled={disabled} onClick={() => onRevert(r.id, true)}>
                    Revert anyway
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
