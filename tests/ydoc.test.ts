import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  acceptRequest, addSuggestion, beginRegeneration, createRequest, endTask, failRequest, failStaleGenerations,
  listRequests, logEvent, readMeta, refreshConflicts, rejectRequest, revertRequest, roomParts, seedRoom,
  selectVersion, startTask, type LogContext,
} from '../shared/ydoc';
import type { Requester, SuggestionVersion } from '../shared/types';

const TEXT = 'Intro paragraph stays the same.\n\nThe committee met many times and talked about lots of things. It decided.\n\nClosing words.';
const TARGET = 'The committee met many times and talked about lots of things.';

const alice: Requester = { participantId: 'P01', name: 'Alice', color: '#e11d48', clientId: 1 };
const bob: Requester = { participantId: 'P02', name: 'Bob', color: '#2563eb', clientId: 2 };

function version(text: string): SuggestionVersion {
  return { text, provider: 'mock', model: 'mock-deterministic', createdAt: 1, latencyMs: 5 };
}

function setup() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  seedRoom(a, { sessionId: 's1', task: 'sandbox', condition: 'direct', initialText: TEXT }, 1000);
  return { a, b };
}

function request(doc: Y.Doc, who: Requester = alice) {
  const from = TEXT.indexOf(TARGET);
  return createRequest(doc, {
    requester: who, commandId: 'shorten', commandLabel: 'Shorten', instruction: 'Make it shorter', typedChars: 0,
    from, to: from + TARGET.length, now: 2000,
  });
}

describe('room seeding and task timing', () => {
  it('seeds the text exactly once', () => {
    const { a, b } = setup();
    expect(seedRoom(b, { sessionId: 's1', task: 'sandbox', condition: 'direct', initialText: TEXT })).toBe(false);
    expect(roomParts(a).text.toString()).toBe(TEXT);
    expect(roomParts(b).text.toString()).toBe(TEXT);
    expect(readMeta(b)).toMatchObject({ sessionId: 's1', condition: 'direct', seededAt: 1000 });
  });

  it('records task start/end once, first writer wins', () => {
    const { a, b } = setup();
    expect(endTask(a, 'P01')).toBe(false); // cannot end before start
    expect(startTask(a, 'P01', 5000)).toBe(true);
    expect(startTask(b, 'P02', 6000)).toBe(false);
    expect(endTask(b, 'P02', 9000)).toBe(true);
    expect(readMeta(a)).toMatchObject({ taskStartedAt: 5000, taskStartedBy: 'P01', taskEndedAt: 9000, taskEndedBy: 'P02' });
  });
});

describe('AI request lifecycle (Figure 1, steps 2-8)', () => {
  it('creates a request with scope, anchors, context and attribution, visible to the partner', () => {
    const { b, a } = setup();
    const r = request(a);
    expect(r.status).toBe('generating');
    expect(r.originalText).toBe(TARGET);
    expect(r.scope).toBe('sentence');
    expect(r.contextBefore.endsWith('\n\n')).toBe(true);
    expect(r.contextAfter.startsWith(' It decided.')).toBe(true);
    expect(listRequests(b)[0]).toMatchObject({ id: r.id, requester: { name: 'Alice' }, status: 'generating' });
  });

  it('rejects empty selections', () => {
    const { a } = setup();
    expect(() => createRequest(a, { requester: alice, commandId: 'rewrite', commandLabel: 'Rewrite', instruction: 'x', typedChars: 0, from: 3, to: 3 })).toThrow();
  });

  it('suggestion -> pending -> accept replaces ONLY the selected range and syncs', () => {
    const { a, b } = setup();
    const r = request(a);
    expect(addSuggestion(a, r.id, version('The committee met often.')).status).toBe('pending');
    const res = acceptRequest(a, r.id, 'P01', {}, 3000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changedOutside).toBe(0);
    expect(res.changedInside).toBeGreaterThan(0);
    const expected = TEXT.replace(TARGET, 'The committee met often.');
    expect(roomParts(a).text.toString()).toBe(expected);
    expect(roomParts(b).text.toString()).toBe(expected);
    const synced = listRequests(b)[0];
    expect(synced).toMatchObject({ status: 'accepted', decidedBy: 'P01', decidedAt: 3000 });
    expect(synced.applied).toMatchObject({ text: 'The committee met often.', beforeText: TARGET, conflictOverride: false });
  });

  it('reject leaves the document untouched', () => {
    const { a } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Short.'));
    expect(rejectRequest(a, r.id, 'P01').ok).toBe(true);
    expect(roomParts(a).text.toString()).toBe(TEXT);
    expect(listRequests(a)[0].status).toBe('rejected');
    expect(acceptRequest(a, r.id, 'P01').ok).toBe(false);
  });

  it('regenerate keeps every version and lets the user pick one', () => {
    const { a } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Version one.'));
    const { variant, record } = beginRegeneration(a, r.id);
    expect(variant).toBe(1);
    expect(record.status).toBe('generating');
    const v2 = addSuggestion(a, r.id, version('Version two.'));
    expect(v2.versions).toHaveLength(2);
    expect(v2.activeVersion).toBe(1);
    selectVersion(a, r.id, 0);
    acceptRequest(a, r.id, 'P01');
    expect(roomParts(a).text.toString()).toContain('Version one.');
  });

  it('a failed regeneration keeps earlier versions reviewable', () => {
    const { a } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Version one.'));
    beginRegeneration(a, r.id);
    const failed = failRequest(a, r.id, 'network down');
    expect(failed).toMatchObject({ status: 'pending', error: 'network down' });
    const r2 = request(a);
    expect(failRequest(a, r2.id, 'bad key')).toMatchObject({ status: 'failed' });
  });

  it('revert restores the replaced text, attributed to whoever reverted', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Short.'));
    acceptRequest(a, r.id, 'P01');
    roomParts(b).text.insert(0, 'Bob typed above. ');
    const res = revertRequest(b, r.id, 'P02', {}, 7000);
    expect(res.ok).toBe(true);
    expect(roomParts(a).text.toString()).toBe('Bob typed above. ' + TEXT);
    expect(listRequests(a)[0]).toMatchObject({ status: 'reverted', revertedBy: 'P02', revertedAt: 7000 });
  });

  it('revert reports a conflict if the inserted text was edited since', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Short sentence.'));
    acceptRequest(a, r.id, 'P01');
    const t = roomParts(b).text;
    t.insert(t.toString().indexOf('sentence.'), 'edited ');
    const res = revertRequest(a, r.id, 'P01');
    expect(res).toMatchObject({ ok: false, reason: 'conflict' });
    expect(revertRequest(a, r.id, 'P01', { force: true }).ok).toBe(true);
    expect(roomParts(a).text.toString()).toBe(TEXT);
  });
});

describe('conflict detection (Figure 1, step 9)', () => {
  it('flags the request when a collaborator edits the anchored text before accept, and blocks accept', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('The committee met often.'));
    const tb = roomParts(b).text;
    tb.insert(tb.toString().indexOf('talked'), 'loudly ');
    const res = acceptRequest(a, r.id, 'P01');
    expect(res).toMatchObject({ ok: false, reason: 'conflict' });
    expect(roomParts(a).text.toString()).toContain('loudly talked');
    const rec = listRequests(b)[0];
    expect(rec.status).toBe('conflicted');
    expect(rec.conflict).toMatchObject({ kind: 'changed', currentText: 'The committee met many times and loudly talked about lots of things.' });
  });

  it('allows an explicit override that still only touches the range', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('The committee met often.'));
    const tb = roomParts(b).text;
    tb.insert(tb.toString().indexOf('talked'), 'loudly ');
    tb.insert(0, 'Header. ');
    const res = acceptRequest(a, r.id, 'P01', { force: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changedOutside).toBe(0);
      expect(res.record.applied?.conflictOverride).toBe(true);
    }
    expect(roomParts(b).text.toString()).toBe('Header. ' + TEXT.replace(TARGET, 'The committee met often.'));
  });

  it('a suggestion arriving after the text changed is stored as conflicted', () => {
    const { a, b } = setup();
    const r = request(a);
    const tb = roomParts(b).text;
    tb.insert(tb.toString().indexOf('committee'), 'whole ');
    expect(addSuggestion(a, r.id, version('x')).status).toBe('conflicted');
  });

  it('edits outside the selection do not cause a conflict', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Met often.'));
    const tb = roomParts(b).text;
    tb.insert(0, 'New first line. ');
    tb.insert(tb.length, ' The end.');
    expect(acceptRequest(a, r.id, 'P01').ok).toBe(true);
  });

  it('a deleted range can only be rejected', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Met often.'));
    const tb = roomParts(b).text;
    tb.delete(tb.toString().indexOf(TARGET), TARGET.length);
    expect(acceptRequest(a, r.id, 'P01', { force: true })).toMatchObject({ ok: false, reason: 'deleted' });
    expect(() => beginRegeneration(a, r.id)).toThrow(/deleted/);
    expect(rejectRequest(a, r.id, 'P01').ok).toBe(true);
  });

  it('regenerating a conflicted request rebases it on the current text', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Met often.'));
    const tb = roomParts(b).text;
    tb.insert(tb.toString().indexOf('talked'), 'loudly ');
    acceptRequest(a, r.id, 'P01');
    const { record } = beginRegeneration(a, r.id, { rebase: true });
    expect(record.originalText).toBe('The committee met many times and loudly talked about lots of things.');
    expect(record.conflict).toBeUndefined();
    expect(addSuggestion(a, r.id, version('They met and talked loudly.')).status).toBe('pending');
    expect(acceptRequest(a, r.id, 'P01').ok).toBe(true);
    expect(roomParts(b).text.toString()).toContain('They met and talked loudly.');
  });

  it('refreshConflicts only writes requests owned by the caller and recovers when text is restored', () => {
    const { a, b } = setup();
    const r = request(a);
    addSuggestion(a, r.id, version('Met.'));
    const tb = roomParts(b).text;
    const at = tb.toString().indexOf('talked');
    tb.insert(at, 'XX ');
    expect(refreshConflicts(b, (x) => x.requester.participantId === 'P02')).toEqual([]);
    expect(listRequests(a)[0].status).toBe('pending');
    const t1 = refreshConflicts(a, (x) => x.requester.participantId === 'P01');
    expect(t1).toMatchObject([{ id: r.id, from: 'pending', to: 'conflicted' }]);
    tb.delete(at, 3);
    const t2 = refreshConflicts(a, (x) => x.requester.participantId === 'P01');
    expect(t2).toMatchObject([{ id: r.id, from: 'conflicted', to: 'pending' }]);
  });

  it('two overlapping requests: accepting one conflicts the other', () => {
    const { a, b } = setup();
    const ra = request(a, alice);
    const rb = request(b, bob);
    addSuggestion(a, ra.id, version('Alice version.'));
    addSuggestion(b, rb.id, version('Bob version.'));
    expect(acceptRequest(a, ra.id, 'P01').ok).toBe(true);
    expect(acceptRequest(b, rb.id, 'P02')).toMatchObject({ ok: false, reason: 'conflict' });
    expect(roomParts(b).text.toString()).toContain('Alice version.');
  });

  it('marks interrupted generations of the reloading user as failed', () => {
    const { a } = setup();
    request(a);
    expect(failStaleGenerations(a, 'P01', 1000, 2000 + 5000)).toBe(1);
    expect(listRequests(a)[0].status).toBe('failed');
  });
});

describe('event log', () => {
  it('appends events visible to all clients', () => {
    const { a, b } = setup();
    const ctx: LogContext = { participantId: 'P01', name: 'Alice', condition: 'direct', task: 'T1' };
    logEvent(a, ctx, 'ai_request', { typedChars: 0, commandId: 'shorten' }, 10);
    const events = roomParts(b).events.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'ai_request', participantId: 'P01', t: 10, data: { commandId: 'shorten' } });
  });
});
