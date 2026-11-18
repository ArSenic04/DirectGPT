import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { colorForId, colorForIndex } from '../shared/colors';
import { isPairRole, itemsForRole, parseRole, roleLabel } from '../shared/roles';
import { findTask } from '../shared/tasks';
import {
  acceptRequest, addSuggestion, createRequest, listRoster, logEvent, refreshConflicts, registerParticipant, roomParts, rosterIndex, seedRoom,
  type LogContext,
} from '../shared/ydoc';
import { buildExport, summaryCsv } from '../shared/exportData';
import { analyze } from '../shared/analysis';
import type { Requester } from '../shared/types';

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('colours for N collaborators', () => {
  it('gives 50 participants distinct, valid hex colours', () => {
    const colors = Array.from({ length: 50 }, (_, i) => colorForIndex(i));
    expect(new Set(colors).size).toBe(50);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorForIndex(0)).toBe('#e11d48');
    expect(colorForIndex(1)).toBe('#2563eb');
    expect(colorForIndex(-3)).toBe(colorForIndex(0));
    expect(colorForId('P01')).toBe(colorForId('P01'));
  });
});

describe('study roles', () => {
  it('parses single letters and treats anything else as no role', () => {
    expect(parseRole('a')).toBe('A');
    expect(parseRole('C')).toBe('C');
    expect(parseRole('')).toBeNull();
    expect(parseRole('AB')).toBeNull();
    expect(parseRole(null)).toBeNull();
    expect(isPairRole('A')).toBe(true);
    expect(isPairRole('C')).toBe(false);
    expect(roleLabel('B')).toBe('Partner B');
    expect(roleLabel('D')).toBe('Extra editor (D)');
    expect(roleLabel(null)).toBe('Editor');
  });

  it('gives A/B their items and shows extra editors and no-role users every item', () => {
    const t1 = findTask('T1')!;
    const a = itemsForRole(t1, 'A');
    expect(a.mine.map((i) => i.id)).toEqual(['T1-A1', 'T1-A2', 'T1-A3']);
    expect(a.others.map((g) => g.role)).toEqual(['B']);
    for (const role of ['C', null]) {
      const x = itemsForRole(t1, role);
      expect(x.mine).toEqual([]);
      expect(x.others.flatMap((g) => g.items)).toHaveLength(6);
    }
    expect(itemsForRole(findTask('sandbox')!, null)).toEqual({ mine: [], others: [] });
  });

  it('finds tasks case-insensitively', () => {
    expect(findTask('t1')?.id).toBe('T1');
    expect(findTask('Sandbox')?.id).toBe('sandbox');
    expect(findTask('nope')).toBeUndefined();
  });
});

describe('room roster', () => {
  it('keeps join order across concurrent joins so every client derives the same colours', () => {
    const docs = Array.from({ length: 5 }, () => new Y.Doc());
    docs.forEach((d, i) => registerParticipant(d, { participantId: `U${i}`, name: `User ${i}`, role: i < 2 ? 'AB'[i] : null }, 1000 + (i % 2)));
    for (let i = 0; i < docs.length; i++) for (let j = 0; j < docs.length; j++) if (i !== j) sync(docs[i], docs[j]);
    const orders = docs.map((d) => listRoster(d).map((e) => e.participantId));
    for (const o of orders) expect(o).toEqual(orders[0]);
    expect(orders[0]).toEqual(['U0', 'U2', 'U4', 'U1', 'U3']);
    const indices = docs.map((d, i) => rosterIndex(d, `U${i}`));
    expect(new Set(indices).size).toBe(5);
  });

  it('keeps the first join time when someone rejoins', () => {
    const doc = new Y.Doc();
    registerParticipant(doc, { participantId: 'P1', name: 'A', role: null }, 5);
    registerParticipant(doc, { participantId: 'P1', name: 'A2', role: 'C' }, 50);
    expect(listRoster(doc)).toEqual([{ participantId: 'P1', name: 'A2', role: 'C', joinedAt: 5, lastSeenAt: 50 }]);
    expect(rosterIndex(doc, 'nobody')).toBe(-1);
  });
});

describe('four collaborators in one room', () => {
  const people = ['A', 'B', 'C', 'D'].map((r, i) => ({ participantId: `P${i + 1}`, name: `User${r}`, role: r, color: colorForIndex(i), clientId: i + 1 }));
  const requester = (i: number): Requester => ({ participantId: people[i].participantId, name: people[i].name, color: people[i].color, clientId: people[i].clientId });

  it('flags a conflict between two extra editors, while other requests stay pending, and exports all four', () => {
    const task = findTask('T1')!;
    const docs = people.map(() => new Y.Doc());
    seedRoom(docs[0], { sessionId: 's4', task: 'T1', condition: 'direct', initialText: task.text }, 0);
    for (const d of docs.slice(1)) sync(docs[0], d);
    docs.forEach((d, i) => {
      registerParticipant(d, people[i], i);
      const ctx: LogContext = { participantId: people[i].participantId, name: people[i].name, condition: 'direct', task: 'T1' };
      logEvent(d, ctx, 'session_join', { role: people[i].role }, i);
    });
    const all = () => { for (let i = 0; i < docs.length; i++) for (let j = 0; j < docs.length; j++) if (i !== j) sync(docs[i], docs[j]); };
    all();

    // C asks for an edit on paragraph 3; A asks for one on the last sentence.
    const p3 = task.items.find((i) => i.id === 'T1-A2')!.target;
    const last = task.items.find((i) => i.id === 'T1-A3')!.target;
    const textC = roomParts(docs[2]).text.toString();
    const rc = createRequest(docs[2], { requester: requester(2), commandId: 'grammar', commandLabel: 'Fix grammar', instruction: 'x', typedChars: 0, from: textC.indexOf(p3), to: textC.indexOf(p3) + p3.length });
    addSuggestion(docs[2], rc.id, { text: p3.replace('Volunteers is', 'Volunteers are'), provider: 'mock', model: 'm', createdAt: 1, latencyMs: 1 });
    const ra = createRequest(docs[0], { requester: requester(0), commandId: 'tone-formal', commandLabel: 'Formal', instruction: 'x', typedChars: 0, from: textC.indexOf(last), to: textC.indexOf(last) + last.length });
    addSuggestion(docs[0], ra.id, { text: 'Please inform the coordinators if you will be away.', provider: 'mock', model: 'm', createdAt: 1, latencyMs: 1 });
    all();

    // D edits inside C's anchored paragraph.
    const tD = roomParts(docs[3]).text;
    tD.insert(tD.toString().indexOf('Lunch will be provided') + 'Lunch will be provided'.length, ' for free');
    all();
    refreshConflicts(docs[2], (r) => r.requester.participantId === 'P3');
    refreshConflicts(docs[0], (r) => r.requester.participantId === 'P1');
    all();
    for (const d of docs) {
      const reqs = Array.from(roomParts(d).requests.values());
      expect(reqs.find((r) => r.id === rc.id)?.status).toBe('conflicted');
      expect(reqs.find((r) => r.id === ra.id)?.status).toBe('pending');
    }
    expect(acceptRequest(docs[2], rc.id, 'P3').ok).toBe(false);
    expect(acceptRequest(docs[0], ra.id, 'P1').ok).toBe(true);
    all();
    for (const d of docs) expect(roomParts(d).text.toString()).toContain('Please inform the coordinators');

    const exp = buildExport(docs[1], 's4.T1.direct')!;
    expect(exp.roster.map((r) => r.participantId)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(exp.summary.participantCount).toBe(4);
    expect(exp.summary.participants.map((p) => p.role)).toEqual(['A', 'B', 'C', 'D']);
    const csv = summaryCsv(exp).trim().split('\n');
    expect(csv).toHaveLength(5);
    expect(csv[0]).toContain('role');
    const result = analyze([exp]);
    expect(result.participants).toHaveLength(4);
    expect(analyze([exp], { pairRolesOnly: true }).participants.map((p) => p.role)).toEqual(['A', 'B']);
    expect(result.team[0].values.participantCount).toBe(4);
  });
});
