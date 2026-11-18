import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { countActivity, summarizeSession } from '../shared/metrics';
import { buildExport, eventsCsv, questionnairesCsv, summaryCsv } from '../shared/exportData';
import { csvEscape, toCsv } from '../shared/csv';
import { acceptRequest, addSuggestion, createRequest, endTask, logEvent, roomParts, seedRoom, startTask, submitQuestionnaire, type LogContext } from '../shared/ydoc';
import { findTask } from '../shared/tasks';
import { isQuestionnaireComplete, LIKERT_ITEMS, scoreQuestionnaire, TLX_SCALES } from '../shared/questionnaire';
import type { LogEvent } from '../shared/types';

const ctxA: LogContext = { participantId: 'P01', name: 'Alice', condition: 'direct', task: 'T1' };
const ctxB: LogContext = { participantId: 'P02', name: 'Bob', condition: 'direct', task: 'T1' };

function ev(type: LogEvent['type'], data: LogEvent['data'], pid = 'P01'): LogEvent {
  return { id: Math.random().toString(), t: 0, type, participantId: pid, name: pid, condition: 'direct', task: 'T1', data };
}

describe('countActivity', () => {
  it('counts prompts, typed characters and decisions', () => {
    const c = countActivity([
      ev('ai_request', { typedChars: 0 }),
      ev('ai_request', { typedChars: 20 }),
      ev('chat_message', { typedChars: 40 }),
      ev('ai_response', { latencyMs: 100 }),
      ev('ai_response', { latencyMs: 300 }),
      ev('accept', { conflictOverride: true }),
      ev('accept', {}),
      ev('reject', {}),
      ev('regenerate', {}),
      ev('conflict_detected', {}),
      ev('revert', {}),
      ev('paste', { length: 12 }),
      ev('manual_edit', { inserted: 5, deleted: 2 }),
      ev('ai_error', {}),
    ]);
    expect(c).toMatchObject({
      prompts: 3, promptChars: 60, meanPromptChars: 20, commandPrompts: 1, accepts: 2, conflictOverrides: 1, rejects: 1,
      regenerations: 1, conflicts: 1, reverts: 1, pastes: 1, pasteChars: 12, manualEditChars: 7, aiErrors: 1, meanLatencyMs: 200,
    });
  });

  it('handles empty logs', () => {
    expect(countActivity([])).toMatchObject({ prompts: 0, meanPromptChars: null, meanLatencyMs: null });
  });
});

describe('questionnaire scoring', () => {
  it('averages constructs and raw TLX', () => {
    const likert = Object.fromEntries(LIKERT_ITEMS.map((i) => [i.id, i.construct === 'control' ? 7 : i.construct === 'transparency' ? 4 : 1]));
    const tlx = Object.fromEntries(TLX_SCALES.map((s, k) => [s.id, k * 10]));
    expect(scoreQuestionnaire(likert, tlx)).toEqual({ control: 7, transparency: 4, coordination: 1, tlxRaw: 25 });
    expect(isQuestionnaireComplete(likert, tlx)).toBe(true);
    expect(isQuestionnaireComplete({}, tlx)).toBe(false);
    expect(scoreQuestionnaire({}, {})).toEqual({ control: null, transparency: null, coordination: null, tlxRaw: null });
  });
});

describe('session summary and export', () => {
  function session() {
    const doc = new Y.Doc();
    const task = findTask('T1')!;
    seedRoom(doc, { sessionId: 'pair1', task: 'T1', condition: 'direct', initialText: task.text }, 0);
    startTask(doc, 'P01', 10_000);
    const target = task.items.find((i) => i.id === 'T1-A2')!.target;
    const from = task.text.indexOf(target);
    const r = createRequest(doc, { requester: { participantId: 'P01', name: 'Alice', color: '#f00', clientId: 1 }, commandId: 'grammar', commandLabel: 'Fix grammar', instruction: 'Fix', typedChars: 0, from, to: from + target.length });
    logEvent(doc, ctxA, 'ai_request', { requestId: r.id, typedChars: 0 });
    addSuggestion(doc, r.id, { text: target.replace('Volunteers is', 'Volunteers are'), provider: 'mock', model: 'm', createdAt: 0, latencyMs: 1 });
    acceptRequest(doc, r.id, 'P01');
    logEvent(doc, ctxA, 'accept', { requestId: r.id });
    // Bob makes an edit outside every task target: an unintended modification of 4 chars.
    const t = roomParts(doc).text;
    t.insert(t.toString().indexOf('Our biggest'), 'Hi! ');
    logEvent(doc, ctxB, 'manual_edit', { inserted: 4, deleted: 0 });
    endTask(doc, 'P02', 70_500);
    submitQuestionnaire(doc, {
      id: 'q1', participantId: 'P01', name: 'Alice', role: 'A', condition: 'direct', task: 'T1', submittedAt: 80_000,
      likert: Object.fromEntries(LIKERT_ITEMS.map((i) => [i.id, 6])), tlx: Object.fromEntries(TLX_SCALES.map((s) => [s.id, 30])), comment: 'nice, "quoted"',
    });
    return doc;
  }

  it('computes task time and unintended vs intended changes against the task targets', () => {
    const exp = buildExport(session(), 'pair1.T1.direct', new Date(0))!;
    expect(exp.schema).toBe('collab-directgpt/session-export@1');
    expect(exp.summary.taskTimeSec).toBe(60.5);
    expect(exp.summary.unintendedChangeChars).toBe(4);
    expect(exp.summary.intendedChangeChars).toBeGreaterThan(0);
    expect(exp.summary.prompts).toBe(1);
    expect(exp.summary.accepts).toBe(1);
    const alice = exp.summary.participants.find((p) => p.participantId === 'P01')!;
    expect(alice.questionnaire).toEqual({ control: 6, transparency: 6, coordination: 6, tlxRaw: 30 });
    const bob = exp.summary.participants.find((p) => p.participantId === 'P02')!;
    expect(bob.manualEditChars).toBe(4);
    // anchors are internal and not exported
    expect(JSON.stringify(exp.requests)).not.toContain('"anchor"');
    expect(exp.requests[0].applied?.beforeText).toContain('Volunteers is');
  });

  it('writes CSVs with one row per event / participant / questionnaire', () => {
    const exp = buildExport(session(), 'pair1.T1.direct')!;
    const events = eventsCsv(exp).trim().split('\n');
    expect(events[0].startsWith('room,session,task,condition,time_iso')).toBe(true);
    expect(events).toHaveLength(1 + exp.events.length);
    const summary = summaryCsv(exp).trim().split('\n');
    expect(summary).toHaveLength(3);
    expect(summary[0]).toContain('team_unintendedChangeChars');
    const q = questionnairesCsv(exp);
    expect(q).toContain('"nice, ""quoted"""');
  });

  it('returns null for an unseeded document', () => {
    expect(buildExport(new Y.Doc(), 'x.y.direct')).toBeNull();
  });

  it('summary works without targets (sandbox)', () => {
    const doc = new Y.Doc();
    seedRoom(doc, { sessionId: 's', task: 'sandbox', condition: 'baseline', initialText: 'abc' });
    const s = summarizeSession({ meta: { sessionId: 's', task: 'sandbox', condition: 'baseline', initialText: 'abc', seededAt: 0 }, events: [], questionnaires: [], finalText: 'abd', targets: null });
    expect(s.unintendedChangeChars).toBeNull();
    expect(s.taskTimeSec).toBeNull();
  });
});

describe('csv', () => {
  it('escapes special characters', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(NaN)).toBe('');
    expect(toCsv([{ a: 1, b: 'x' }, { a: 2 }])).toBe('a,b\n1,x\n2,\n');
  });
});
