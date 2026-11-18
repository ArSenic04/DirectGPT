/**
 * One AI edit request: preview, approval and conflict handling
 * (Figure 1, steps 5, 6 and 9). Only the requester can decide; collaborators
 * see the same card read-only.
 */
import type { AIRequestRecord } from '../../../shared/types';
import type { AnchorCheck } from '../../../shared/anchors';
import { DiffView } from './DiffView';
import { MockBadge, StatusBadge } from './StatusBadge';

export interface RequestActions {
  accept: (id: string, force?: boolean) => void;
  reject: (id: string) => void;
  regenerate: (id: string, rebase?: boolean) => void;
  selectVersion: (id: string, index: number) => void;
  focusRequest: (id: string) => void;
}

interface Props {
  record: AIRequestRecord;
  live: AnchorCheck | null;
  isMine: boolean;
  actions: RequestActions;
  disabled: boolean;
}

export function PreviewCard({ record: r, live, isMine, actions, disabled }: Props) {
  const version = r.versions[r.activeVersion];
  const conflictKind = r.status === 'conflicted' ? r.conflict?.kind ?? (live?.state === 'deleted' ? 'deleted' : 'changed') : null;
  const othersChanged = r.status === 'pending' && live !== null && live.state !== 'ok';
  const instructionShown = r.commandId === 'custom' || r.commandId.startsWith('saved:') ? `“${r.instruction}”` : r.commandLabel;

  return (
    <div className={`cdg-card cdg-card-${r.status}`} data-testid="preview-card" data-request-id={r.id} data-status={r.status}>
      <div className="cdg-card-head">
        <span className="cdg-dot" style={{ background: r.requester.color }} />
        <strong>{isMine ? 'You' : r.requester.name}</strong>
        <span className="cdg-muted">asked</span>
        <span className="cdg-instruction" title={r.instruction}>{instructionShown}</span>
        <span className="cdg-chip">{r.scope}</span>
        <span className="cdg-spacer" />
        {version?.provider === 'mock' && <MockBadge />}
        <StatusBadge status={r.status} />
      </div>

      {r.status === 'generating' && (
        <div className="cdg-generating" data-testid="generating">
          <span className="cdg-spinner" /> The AI is working on {isMine ? 'your' : `${r.requester.name}'s`} request…
        </div>
      )}

      {r.error && r.status !== 'generating' && (
        <div className="cdg-error" role="alert" data-testid="request-error">{r.error}</div>
      )}

      {conflictKind && (
        <div className="cdg-conflict" role="alert" data-testid="conflict-banner">
          {conflictKind === 'deleted' ? (
            <>The selected text was <strong>deleted</strong> after this request was made. The suggestion can no longer be applied.</>
          ) : (
            <>
              The selected text was <strong>changed by a collaborator</strong> after this request was made. Applying now would overwrite
              their change. Current text:<q data-testid="conflict-current">{r.conflict?.currentText ?? live?.currentText}</q>
            </>
          )}
        </div>
      )}
      {othersChanged && !isMine && <div className="cdg-conflict">The selected text has changed since this request.</div>}

      {version && r.status !== 'generating' && (
        <>
          {r.versions.length > 1 && (
            <div className="cdg-versions" data-testid="version-nav">
              <button
                className="cdg-btn cdg-btn-small"
                aria-label="Previous version"
                disabled={!isMine || r.activeVersion === 0 || disabled}
                onClick={() => actions.selectVersion(r.id, r.activeVersion - 1)}
              >
                ‹
              </button>
              <span data-testid="version-label">Version {r.activeVersion + 1} of {r.versions.length}</span>
              <button
                className="cdg-btn cdg-btn-small"
                aria-label="Next version"
                disabled={!isMine || r.activeVersion >= r.versions.length - 1 || disabled}
                onClick={() => actions.selectVersion(r.id, r.activeVersion + 1)}
              >
                ›
              </button>
            </div>
          )}
          {version.text === (r.status === 'conflicted' && r.conflict ? r.conflict.currentText : r.originalText) && (
            <div className="cdg-muted" data-testid="no-change">The AI suggested no changes for this text.</div>
          )}
          <DiffView
            before={r.status === 'conflicted' && r.conflict ? r.conflict.currentText : r.originalText}
            beforeLabel={r.status === 'conflicted' && r.conflict ? 'Current text' : 'Original'}
            after={version.text}
            testId="preview-diff"
          />
        </>
      )}

      <div className="cdg-card-actions">
        <button className="cdg-btn cdg-btn-ghost cdg-btn-small" onClick={() => actions.focusRequest(r.id)} title="Select this text in the document">
          Show in document
        </button>
        <span className="cdg-spacer" />
        {!isMine && <span className="cdg-muted" data-testid="only-requester">Only {r.requester.name} can accept or reject this.</span>}
        {isMine && r.status === 'pending' && (
          <>
            <button className="cdg-btn" data-testid="regenerate" disabled={disabled} onClick={() => actions.regenerate(r.id)}>↻ Regenerate</button>
            <button className="cdg-btn cdg-btn-danger" data-testid="reject" disabled={disabled} onClick={() => actions.reject(r.id)}>✕ Reject</button>
            <button className="cdg-btn cdg-btn-primary" data-testid="accept" disabled={disabled} onClick={() => actions.accept(r.id)}>✓ Accept</button>
          </>
        )}
        {isMine && r.status === 'conflicted' && (
          <>
            <button className="cdg-btn cdg-btn-danger" data-testid="reject" disabled={disabled} onClick={() => actions.reject(r.id)}>✕ Reject</button>
            {conflictKind === 'changed' && (
              <>
                <button className="cdg-btn" data-testid="regenerate-current" disabled={disabled} onClick={() => actions.regenerate(r.id, true)}>
                  ↻ Regenerate on current text
                </button>
                <button className="cdg-btn cdg-btn-warn" data-testid="apply-anyway" disabled={disabled} onClick={() => actions.accept(r.id, true)}>
                  Apply anyway
                </button>
              </>
            )}
          </>
        )}
        {isMine && r.status === 'failed' && (
          <>
            <button className="cdg-btn cdg-btn-danger" data-testid="reject" disabled={disabled} onClick={() => actions.reject(r.id)}>✕ Dismiss</button>
            <button className="cdg-btn" data-testid="retry" disabled={disabled} onClick={() => actions.regenerate(r.id)}>↻ Retry</button>
          </>
        )}
        {isMine && r.status === 'generating' && (
          <button className="cdg-btn cdg-btn-danger" data-testid="cancel" disabled={disabled} onClick={() => actions.reject(r.id)}>Cancel</button>
        )}
      </div>
    </div>
  );
}
