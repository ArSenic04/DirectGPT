/**
 * Anchoring selections with Yjs relative positions (Figure 1, step 9).
 *
 * A request remembers *where* its selection was through Y.RelativePosition
 * objects instead of raw offsets, so concurrent edits elsewhere in the
 * document (typing above the selection, another accepted AI edit, ...) move
 * the anchors along with the text. The start anchor sticks to the first
 * selected character and the end anchor to the last one, so text inserted
 * right before or right after the selection is not pulled into it.
 */
import * as Y from 'yjs';
import type { Anchor } from './types';
import { minimalEdits } from './diff';

export function createAnchor(ytext: Y.Text, from: number, to: number): Anchor {
  const start = Y.createRelativePositionFromTypeIndex(ytext, from, 0);
  const end = Y.createRelativePositionFromTypeIndex(ytext, to, -1);
  return {
    start: Y.relativePositionToJSON(start) as Anchor['start'],
    end: Y.relativePositionToJSON(end) as Anchor['end'],
  };
}

export interface ResolvedAnchor {
  from: number;
  to: number;
}

/** Absolute positions of an anchor, or null if it can no longer be resolved. */
export function resolveAnchor(doc: Y.Doc, anchor: Anchor): ResolvedAnchor | null {
  const start = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(anchor.start),
    doc,
  );
  const end = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(anchor.end),
    doc,
  );
  if (!start || !end) return null;
  // If everything between the anchors was deleted the end can resolve before
  // the start; treat that as an empty range at the start.
  return { from: start.index, to: Math.max(start.index, end.index) };
}

export type AnchorState = 'ok' | 'changed' | 'deleted';

export interface AnchorCheck {
  state: AnchorState;
  from: number;
  to: number;
  currentText: string;
}

/**
 * Compare the text currently between the anchors with the text the request
 * was made on. "deleted" means the whole range disappeared.
 */
export function checkAnchor(doc: Y.Doc, ytext: Y.Text, anchor: Anchor, expectedText: string): AnchorCheck {
  const resolved = resolveAnchor(doc, anchor);
  if (!resolved) return { state: 'deleted', from: 0, to: 0, currentText: '' };
  const currentText = ytext.toString().slice(resolved.from, resolved.to);
  if (currentText === expectedText) return { state: 'ok', ...resolved, currentText };
  if (currentText.length === 0 && expectedText.length > 0) {
    return { state: 'deleted', ...resolved, currentText };
  }
  return { state: 'changed', ...resolved, currentText };
}

/**
 * Replace ytext[from, to) with `replacement` using a minimal set of
 * insert/delete operations. Must be called inside a transaction for
 * atomicity.
 */
export function replaceRange(ytext: Y.Text, from: number, to: number, replacement: string): void {
  const current = ytext.toString().slice(from, to);
  for (const edit of minimalEdits(current, replacement)) {
    if (edit.deleteCount > 0) ytext.delete(from + edit.at, edit.deleteCount);
    if (edit.insert.length > 0) ytext.insert(from + edit.at, edit.insert);
  }
}

/** True if two ranges overlap (touching ranges do not overlap). */
export function rangesOverlap(a: ResolvedAnchor, b: ResolvedAnchor): boolean {
  return a.from < b.to && b.from < a.to;
}
