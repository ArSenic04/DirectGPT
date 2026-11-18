/**
 * SYNTHETIC demo data for the analysis pipeline. These exports are generated
 * through the same shared Yjs operations the app uses, but the behaviour is
 * simulated with a seeded random generator. They are NOT study results.
 */
import * as Y from 'yjs';
import { buildExport, type SessionExport } from '../shared/exportData';
import { acceptRequest, addSuggestion, createRequest, endTask, logEvent, roomParts, seedRoom, startTask, submitQuestionnaire } from '../shared/ydoc';
import { findTask } from '../shared/tasks';
import { LIKERT_ITEMS, TLX_SCALES } from '../shared/questionnaire';
import { orderForPair } from '../shared/counterbalance';
import { mockTransform } from '../shared/mockLLM';
import type { Condition } from '../shared/types';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function demoExports(pairs = 8, seed = 42): SessionExport[] {
  const rand = rng(seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const out: SessionExport[] = [];
  for (let pair = 1; pair <= pairs; pair++) {
    const sessionId = `demo${String(pair).padStart(2, '0')}`;
    const people = [
      { participantId: `${sessionId}-A`, name: 'A', role: 'A' as const, color: '#e11d48', clientId: 1 },
      { participantId: `${sessionId}-B`, name: 'B', role: 'B' as const, color: '#2563eb', clientId: 2 },
    ];
    for (const step of orderForPair(pair)) {
      const condition: Condition = step.condition;
      const task = findTask(step.task)!;
      const doc = new Y.Doc();
      const t0 = Date.UTC(2026, 10, 1, 14) + pair * 3_600_000 + (step.task === 'T2' ? 1_800_000 : 0);
      seedRoom(doc, { sessionId, task: task.id, condition, initialText: task.text }, t0);
      startTask(doc, people[0].participantId, t0 + 1000);
      let t = t0 + 1000;
      for (const item of task.items) {
        const who = people.find((p) => p.role === item.role)!;
        const ctx = { participantId: who.participantId, name: who.name, condition, task: task.id };
        const text = roomParts(doc).text;
        const from = text.toString().indexOf(item.target);
        if (from < 0) continue;
        t += between(20_000, condition === 'direct' ? 60_000 : 110_000);
        if (condition === 'direct') {
          const r = createRequest(doc, { requester: { participantId: who.participantId, name: who.name, color: who.color, clientId: who.clientId }, commandId: 'rewrite', commandLabel: 'Rewrite', instruction: item.instruction, typedChars: 0, from, to: from + item.target.length, now: t });
          logEvent(doc, ctx, 'ai_request', { requestId: r.id, typedChars: 0 }, t);
          addSuggestion(doc, r.id, { text: mockTransform('rewrite', item.instruction, item.target, 0), provider: 'mock', model: 'mock', createdAt: t, latencyMs: 700 }, t);
          logEvent(doc, ctx, 'ai_response', { requestId: r.id, latencyMs: 700 }, t);
          if (rand() < 0.15) logEvent(doc, ctx, 'regenerate', { requestId: r.id }, t);
          acceptRequest(doc, r.id, who.participantId, {}, t);
          logEvent(doc, ctx, 'accept', { requestId: r.id }, t);
        } else {
          logEvent(doc, ctx, 'chat_message', { typedChars: Math.round(between(40, 120)) }, t);
          logEvent(doc, ctx, 'chat_response', { latencyMs: 1500 }, t);
          // Whole-document regeneration: sometimes text outside the target drifts too.
          const full = text.toString();
          const revised = mockTransform('rewrite', item.instruction, item.target, 0);
          doc.transact(() => {
            text.delete(from, item.target.length);
            text.insert(from, revised);
            if (rand() < 0.5) {
              const at = full.indexOf(' and ', from + revised.length);
              if (at > 0) {
                text.delete(at, 5);
                text.insert(at, ' & ');
              }
            }
          });
          logEvent(doc, ctx, 'paste', { length: full.length }, t);
        }
      }
      endTask(doc, people[1].participantId, t + between(5_000, 20_000));
      for (const p of people) {
        const shift = condition === 'direct' ? 1 : 0;
        submitQuestionnaire(doc, {
          id: `${sessionId}-${task.id}-${p.role}`, participantId: p.participantId, name: p.name, role: p.role, condition, task: task.id, submittedAt: t + 60_000,
          likert: Object.fromEntries(LIKERT_ITEMS.map((i) => [i.id, Math.max(1, Math.min(7, Math.round(between(3, 6) + shift)))])),
          tlx: Object.fromEntries(TLX_SCALES.map((s) => [s.id, Math.round(between(20, 60) - shift * 10)])),
          comment: 'synthetic',
        });
      }
      const exp = buildExport(doc, `${sessionId}.${task.id}.${condition}`, new Date(t + 120_000));
      if (exp) out.push(exp);
    }
  }
  return out;
}
