import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { checkAnchor, createAnchor, rangesOverlap, replaceRange, resolveAnchor } from '../shared/anchors';

function makeDoc(text: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  ytext.insert(0, text);
  return { doc, ytext };
}

/** Two replicas kept in sync, like two browser tabs. */
function makePair(text: string) {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  a.getText('content').insert(0, text);
  return { a, b, ta: a.getText('content'), tb: b.getText('content') };
}

describe('anchors (relative positions)', () => {
  const TEXT = 'First sentence. Target sentence here. Last sentence.';
  const FROM = TEXT.indexOf('Target');
  const TO = FROM + 'Target sentence here.'.length;

  it('resolves to the original range when nothing changed', () => {
    const { doc, ytext } = makeDoc(TEXT);
    const anchor = createAnchor(ytext, FROM, TO);
    expect(resolveAnchor(doc, anchor)).toEqual({ from: FROM, to: TO });
    expect(checkAnchor(doc, ytext, anchor, 'Target sentence here.').state).toBe('ok');
  });

  it('follows the text when someone types before the selection (raw offsets would break)', () => {
    const { doc, ytext } = makeDoc(TEXT);
    const anchor = createAnchor(ytext, FROM, TO);
    ytext.insert(0, 'NEW INTRO. ');
    const r = resolveAnchor(doc, anchor)!;
    expect(ytext.toString().slice(r.from, r.to)).toBe('Target sentence here.');
    expect(checkAnchor(doc, ytext, anchor, 'Target sentence here.').state).toBe('ok');
  });

  it('does not absorb text inserted right before or right after the selection', () => {
    const { doc, ytext } = makeDoc(TEXT);
    const anchor = createAnchor(ytext, FROM, TO);
    ytext.insert(TO, ' (after)');
    ytext.insert(FROM, '(before) ');
    const r = resolveAnchor(doc, anchor)!;
    expect(ytext.toString().slice(r.from, r.to)).toBe('Target sentence here.');
  });

  it('reports "changed" when the anchored text is edited', () => {
    const { doc, ytext } = makeDoc(TEXT);
    const anchor = createAnchor(ytext, FROM, TO);
    ytext.insert(FROM + 'Target'.length, ' (edited)');
    const check = checkAnchor(doc, ytext, anchor, 'Target sentence here.');
    expect(check.state).toBe('changed');
    expect(check.currentText).toBe('Target (edited) sentence here.');
  });

  it('reports "deleted" when the whole range is removed', () => {
    const { doc, ytext } = makeDoc(TEXT);
    const anchor = createAnchor(ytext, FROM, TO);
    ytext.delete(FROM, TO - FROM);
    expect(checkAnchor(doc, ytext, anchor, 'Target sentence here.').state).toBe('deleted');
  });

  it('works across replicas: anchors created on one client resolve on the other', () => {
    const { a, b, ta, tb } = makePair(TEXT);
    const anchor = createAnchor(ta, FROM, TO);
    // Serialised anchors travel through the shared map as JSON.
    const transported = JSON.parse(JSON.stringify(anchor));
    tb.insert(0, 'Partner typed this. ');
    expect(checkAnchor(b, tb, transported, 'Target sentence here.').state).toBe('ok');
    expect(checkAnchor(a, ta, anchor, 'Target sentence here.').state).toBe('ok');
    tb.insert(tb.toString().indexOf('sentence here'), 'big ');
    expect(checkAnchor(a, ta, anchor, 'Target sentence here.').state).toBe('changed');
  });

  it('replaceRange changes only the range', () => {
    const { ytext } = makeDoc(TEXT);
    replaceRange(ytext, FROM, TO, 'Short one.');
    expect(ytext.toString()).toBe('First sentence. Short one. Last sentence.');
  });

  it('rangesOverlap ignores touching ranges', () => {
    expect(rangesOverlap({ from: 0, to: 5 }, { from: 5, to: 9 })).toBe(false);
    expect(rangesOverlap({ from: 0, to: 6 }, { from: 5, to: 9 })).toBe(true);
  });
});
