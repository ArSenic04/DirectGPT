import { describe, expect, it } from 'vitest';
import { applyEdits, changeStats, diffSegments, minimalEdits, scopedChanges } from '../shared/diff';

describe('diffSegments', () => {
  it('marks inserted and deleted words and reconstructs both texts', () => {
    const before = 'The quick brown fox jumps.';
    const after = 'The slow brown fox leaps.';
    const segs = diffSegments(before, after);
    expect(segs.filter((s) => s.type !== 'insert').map((s) => s.text).join('')).toBe(before);
    expect(segs.filter((s) => s.type !== 'delete').map((s) => s.text).join('')).toBe(after);
    expect(segs.some((s) => s.type === 'delete' && s.text.includes('quick'))).toBe(true);
    expect(segs.some((s) => s.type === 'insert' && s.text.includes('slow'))).toBe(true);
  });

  it('returns a single equal segment for identical texts', () => {
    expect(diffSegments('same text', 'same text')).toEqual([{ type: 'equal', text: 'same text' }]);
  });
});

describe('changeStats', () => {
  it('counts inserted and deleted characters', () => {
    expect(changeStats('abc', 'abc')).toEqual({ inserted: 0, deleted: 0, changed: 0 });
    expect(changeStats('abc', 'abXc')).toEqual({ inserted: 1, deleted: 0, changed: 1 });
    expect(changeStats('abc', 'ac')).toEqual({ inserted: 0, deleted: 1, changed: 1 });
  });
});

describe('scopedChanges (unintended modifications)', () => {
  const before = 'AAAA BBBB CCCC';
  const spans = [{ from: 5, to: 9 }]; // "BBBB"

  it('counts nothing when nothing changed', () => {
    expect(scopedChanges(before, before, spans)).toMatchObject({ inside: 0, outside: 0 });
  });

  it('attributes changes inside the target span as intended', () => {
    const r = scopedChanges(before, 'AAAA XY CCCC', spans);
    expect(r.outside).toBe(0);
    expect(r.inside).toBeGreaterThan(0);
  });

  it('attributes changes outside the target span as unintended', () => {
    const r = scopedChanges(before, 'AAAZ XY CCCC', spans);
    expect(r.outside).toBe(2); // A deleted, Z inserted
    expect(r.outsideRegions[0].at).toBe(3);
  });

  it('counts insertions at the span boundary as inside', () => {
    expect(scopedChanges(before, 'AAAA BBBB!! CCCC', spans)).toMatchObject({ inside: 2, outside: 0 });
    expect(scopedChanges(before, 'AAAA >>BBBB CCCC', spans)).toMatchObject({ inside: 2, outside: 0 });
  });

  it('counts everything as unintended when there are no spans', () => {
    expect(scopedChanges('abc', 'xbc', []).outside).toBe(2);
  });
});

describe('minimalEdits', () => {
  const cases: Array<[string, string]> = [
    ['hello world', 'hello brave new world'],
    ['remove this word please', 'remove word please'],
    ['abc', ''],
    ['', 'new text'],
    ['The barrels will be installed.', 'The four barrels will be installed on Saturday!'],
    ['same', 'same'],
  ];
  it.each(cases)('turns %j into %j', (a, b) => {
    expect(applyEdits(a, minimalEdits(a, b))).toBe(b);
  });

  it('keeps unchanged characters untouched', () => {
    const edits = minimalEdits('one two three', 'one 2 three');
    const deleted = edits.reduce((n, e) => n + e.deleteCount, 0);
    expect(deleted).toBe(3);
  });
});
