/**
 * Diff utilities (Figure 1, step 5 preview and the "unintended
 * modifications" metric). Uses the same `diff` package as DirectGPT.
 */
import { diffChars, diffWordsWithSpace } from 'diff';

export type SegmentType = 'equal' | 'insert' | 'delete';

export interface DiffSegment {
  type: SegmentType;
  text: string;
}

/** Word-level diff for display (original vs suggestion). */
export function diffSegments(before: string, after: string): DiffSegment[] {
  return diffWordsWithSpace(before, after).map((part) => ({
    type: part.added ? 'insert' : part.removed ? 'delete' : 'equal',
    text: part.value,
  }));
}

export interface ChangeStats {
  inserted: number;
  deleted: number;
  /** inserted + deleted characters */
  changed: number;
}

export function changeStats(before: string, after: string): ChangeStats {
  let inserted = 0;
  let deleted = 0;
  for (const part of diffChars(before, after)) {
    if (part.added) inserted += part.value.length;
    else if (part.removed) deleted += part.value.length;
  }
  return { inserted, deleted, changed: inserted + deleted };
}

export interface Span {
  from: number;
  to: number;
}

export interface ScopedChanges {
  /** Characters inserted or deleted inside the intended spans. */
  inside: number;
  /** Characters inserted or deleted outside the intended spans ("unintended modifications"). */
  outside: number;
  /** Positions (in `before`) of the changes that fell outside. */
  outsideRegions: Array<{ at: number; inserted: number; deleted: number }>;
}

function inSpans(pos: number, spans: Span[], inclusiveEnd: boolean): boolean {
  return spans.some((s) => pos >= s.from && (inclusiveEnd ? pos <= s.to : pos < s.to));
}

/**
 * Character-level comparison of `before` and `after`, attributing every
 * changed character to inside/outside the intended `spans` (positions in
 * `before`). Deleted characters are counted at their own position; inserted
 * characters at their insertion point (span ends are inclusive for inserts).
 */
export function scopedChanges(before: string, after: string, spans: Span[]): ScopedChanges {
  let pos = 0;
  let inside = 0;
  let outside = 0;
  const outsideRegions: ScopedChanges['outsideRegions'] = [];
  const note = (at: number, inserted: number, deleted: number) => {
    const last = outsideRegions[outsideRegions.length - 1];
    if (last && Math.abs(last.at - at) <= 1) {
      last.inserted += inserted;
      last.deleted += deleted;
    } else {
      outsideRegions.push({ at, inserted, deleted });
    }
  };
  for (const part of diffChars(before, after)) {
    const len = part.value.length;
    if (part.added) {
      if (inSpans(pos, spans, true)) inside += len;
      else {
        outside += len;
        note(pos, len, 0);
      }
    } else if (part.removed) {
      for (let i = 0; i < len; i++) {
        if (inSpans(pos + i, spans, false)) inside++;
        else {
          outside++;
          note(pos + i, 0, 1);
        }
      }
      pos += len;
    } else {
      pos += len;
    }
  }
  return { inside, outside, outsideRegions };
}

export interface TextEdit {
  /** Offset relative to the start of the edited range, in the text being edited. */
  at: number;
  deleteCount: number;
  insert: string;
}

/**
 * Minimal list of edits turning `before` into `after`, applied left to right
 * (offsets account for earlier edits). Used to apply an accepted suggestion
 * without wiping unchanged characters, which keeps collaborators' cursors and
 * other anchors stable.
 */
export function minimalEdits(before: string, after: string): TextEdit[] {
  const edits: TextEdit[] = [];
  let offset = 0;
  for (const part of diffChars(before, after)) {
    if (part.added) {
      const last = edits[edits.length - 1];
      if (last && last.at + last.insert.length === offset && last.insert.length === 0) {
        last.insert += part.value;
      } else {
        edits.push({ at: offset, deleteCount: 0, insert: part.value });
      }
      offset += part.value.length;
    } else if (part.removed) {
      edits.push({ at: offset, deleteCount: part.value.length, insert: '' });
    } else {
      offset += part.value.length;
    }
  }
  return edits;
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of edits) {
    out = out.slice(0, e.at) + e.insert + out.slice(e.at + e.deleteCount);
  }
  return out;
}
