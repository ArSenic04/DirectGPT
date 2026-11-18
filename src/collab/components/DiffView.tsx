/** Side-by-side original vs suggestion with word-level highlighting (Figure 1, step 5). */
import { useMemo } from 'react';
import { diffSegments } from '../../../shared/diff';

export function DiffView({ before, after, testId, beforeLabel = 'Original' }: { before: string; after: string; testId?: string; beforeLabel?: string }) {
  const segments = useMemo(() => diffSegments(before, after), [before, after]);
  return (
    <div className="cdg-diff" data-testid={testId}>
      <div className="cdg-diff-col">
        <div className="cdg-diff-title">{beforeLabel}</div>
        <div className="cdg-diff-text" data-testid="diff-original">
          {segments.filter((s) => s.type !== 'insert').map((s, i) =>
            s.type === 'delete' ? <del key={i}>{s.text}</del> : <span key={i}>{s.text}</span>,
          )}
        </div>
      </div>
      <div className="cdg-diff-col">
        <div className="cdg-diff-title">Suggestion</div>
        <div className="cdg-diff-text" data-testid="diff-suggestion">
          {segments.filter((s) => s.type !== 'delete').map((s, i) =>
            s.type === 'insert' ? <ins key={i}>{s.text}</ins> : <span key={i}>{s.text}</span>,
          )}
        </div>
      </div>
    </div>
  );
}
