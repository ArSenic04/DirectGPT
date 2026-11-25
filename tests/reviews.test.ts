import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addComment, castVote, listReviews, requireApproval, seedRoom, setRequireApproval } from '../shared/ydoc';
import { approvalStatus, commentsFor, MAX_COMMENT_CHARS, myVote, tally } from '../shared/reviews';
import { buildExport } from '../shared/exportData';
import type { ReviewEntry } from '../shared/types';

const bob = { participantId: 'P02', name: 'Bob', color: '#2563eb' };
const carol = { participantId: 'P03', name: 'Carol', color: '#16a34a' };
const alice = { participantId: 'P01', name: 'Alice', color: '#e11d48' };

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  return { a, b };
}

const entry = (participantId: string, value: ReviewEntry['value'], at: number, requestId = 'r1'): ReviewEntry => ({
  id: `${participantId}${at}`, requestId, kind: 'vote', participantId, name: participantId, color: '#000', value, at,
});

describe('vote counting', () => {
  it('uses each teammate\'s latest vote, lets them take it back, and ignores the requester', () => {
    const entries = [entry('P02', 'up', 1), entry('P03', 'down', 2), entry('P02', 'down', 3), entry('P01', 'up', 4), entry('P03', 'none', 5)];
    const t = tally(entries, 'r1', 'P01');
    expect(t.up).toEqual([]);
    expect(t.down.map((v) => v.participantId)).toEqual(['P02']);
    expect(myVote(entries, 'r1', 'P03')).toBeNull();
    expect(myVote(entries, 'r1', 'P02')).toBe('down');
    expect(tally(entries, 'other', 'P01')).toEqual({ up: [], down: [] });
  });
});

describe('majority approval', () => {
  const votes = (up: number, down: number) => ({ up: Array(up).fill(entry('x', 'up', 1)), down: Array(down).fill(entry('y', 'down', 1)) });

  it('does not block anything when the setting is off or nobody else is online', () => {
    expect(approvalStatus(votes(0, 0), 3, false).met).toBe(true);
    expect(approvalStatus(votes(0, 0), 0, true).met).toBe(true);
  });

  it('needs more than half of the online teammates to give a thumbs-up, and more up than down', () => {
    expect(approvalStatus(votes(0, 0), 1, true)).toMatchObject({ needed: 1, met: false });
    expect(approvalStatus(votes(1, 0), 1, true).met).toBe(true);
    expect(approvalStatus(votes(1, 0), 2, true)).toMatchObject({ needed: 2, met: false });
    expect(approvalStatus(votes(2, 0), 2, true).met).toBe(true);
    expect(approvalStatus(votes(2, 0), 3, true).met).toBe(true);
    expect(approvalStatus(votes(2, 1), 3, true).met).toBe(true);
    expect(approvalStatus(votes(1, 1), 2, true).met).toBe(false);
    expect(approvalStatus(votes(2, 2), 4, true).met).toBe(false);
  });
});

describe('votes and comments in the shared room', () => {
  it('sync to the other client, attributed with name and colour', () => {
    const { a, b } = pair();
    castVote(a, 'r1', bob, 'up', 10);
    addComment(b, 'r1', carol, '  Looks   good\nto me ', MAX_COMMENT_CHARS, 20);
    for (const d of [a, b]) {
      const list = listReviews(d);
      expect(list.map((e) => [e.kind, e.name, e.color])).toEqual([['vote', 'Bob', '#2563eb'], ['comment', 'Carol', '#16a34a']]);
      expect(commentsFor(list, 'r1')[0].text).toBe('Looks good to me');
    }
  });

  it('keeps votes cast at the same moment on different computers', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    castVote(a, 'r1', bob, 'up', 10);
    castVote(b, 'r1', carol, 'down', 10);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    for (const d of [a, b]) {
      const t = tally(listReviews(d), 'r1', alice.participantId);
      expect(t.up.map((v) => v.name)).toEqual(['Bob']);
      expect(t.down.map((v) => v.name)).toEqual(['Carol']);
    }
  });

  it('trims comments to the limit and drops empty ones', () => {
    const d = new Y.Doc();
    expect(addComment(d, 'r1', bob, '   ', MAX_COMMENT_CHARS)).toBeNull();
    expect(addComment(d, 'r1', bob, 'x'.repeat(MAX_COMMENT_CHARS + 50), MAX_COMMENT_CHARS)?.text).toHaveLength(MAX_COMMENT_CHARS);
    expect(listReviews(d)).toHaveLength(1);
  });

  it('shares the "require majority approval" setting, and exports the reviews', () => {
    const { a, b } = pair();
    seedRoom(a, { sessionId: 's', task: 'sandbox', condition: 'direct', initialText: 'Some text.' }, 1000);
    expect(requireApproval(b)).toBe(false);
    setRequireApproval(b, true);
    expect(requireApproval(a)).toBe(true);
    castVote(a, 'r1', bob, 'up', 5);
    const exported = buildExport(b, 's.sandbox.direct');
    expect(exported?.reviews.map((e) => e.value)).toEqual(['up']);
    expect(exported?.meta.requireApproval).toBe(true);
  });
});
