/** Build the JSON/CSV export of a room (used by the server's export endpoint). */
import * as Y from 'yjs';
import { listRequests, readMeta, roomParts } from './ydoc';
import { summarizeSession, type SessionSummary } from './metrics';
import { findTask, targetSpans } from './tasks';
import { toCsv, type CsvValue } from './csv';
import type { AIRequestRecord, LogEvent, QuestionnaireResponse, SessionMeta } from './types';
import { LIKERT_ITEMS, TLX_SCALES } from './questionnaire';

export const EXPORT_SCHEMA = 'collab-directgpt/session-export@1';

export interface SessionExport {
  schema: typeof EXPORT_SCHEMA;
  room: string;
  exportedAt: string;
  meta: SessionMeta;
  initialText: string;
  finalText: string;
  summary: SessionSummary;
  events: LogEvent[];
  requests: Array<Omit<AIRequestRecord, 'anchor' | 'applied'> & { applied?: Omit<NonNullable<AIRequestRecord['applied']>, 'anchor'> }>;
  questionnaires: QuestionnaireResponse[];
}

export function buildExport(doc: Y.Doc, room: string, now: Date = new Date()): SessionExport | null {
  const meta = readMeta(doc);
  if (!meta) return null;
  const parts = roomParts(doc);
  const events = parts.events.toArray().map((e) => ({ ...e })).sort((a, b) => a.t - b.t);
  const questionnaires = parts.questionnaires.toArray().map((q) => ({ ...q }));
  const finalText = parts.text.toString();
  const task = findTask(meta.task);
  const targets = task && task.items.length > 0 && task.text === meta.initialText ? targetSpans(task) : null;
  const summary = summarizeSession({ meta, events, questionnaires, finalText, targets });
  const requests = listRequests(doc).map((r) => {
    const { anchor: _anchor, applied, ...rest } = r;
    void _anchor;
    if (!applied) return rest;
    const { anchor: _a, ...appliedRest } = applied;
    void _a;
    return { ...rest, applied: appliedRest };
  });
  return {
    schema: EXPORT_SCHEMA,
    room,
    exportedAt: now.toISOString(),
    meta,
    initialText: meta.initialText,
    finalText,
    summary,
    events,
    requests,
    questionnaires,
  };
}

export function eventsCsv(exp: SessionExport): string {
  const dataKeys = Array.from(new Set(exp.events.flatMap((e) => Object.keys(e.data)))).sort();
  const rows = exp.events.map((e) => {
    const row: Record<string, CsvValue> = {
      room: exp.room, session: exp.meta.sessionId, task: e.task, condition: e.condition,
      time_iso: new Date(e.t).toISOString(), t_ms: e.t,
      t_rel_s: exp.meta.taskStartedAt !== undefined ? Math.round((e.t - exp.meta.taskStartedAt) / 100) / 10 : null,
      participant: e.participantId, name: e.name, type: e.type,
    };
    for (const k of dataKeys) row[`data_${k}`] = e.data[k];
    return row;
  });
  const cols = ['room', 'session', 'task', 'condition', 'time_iso', 't_ms', 't_rel_s', 'participant', 'name', 'type', ...dataKeys.map((k) => `data_${k}`)];
  return toCsv(rows, cols);
}

const ACTIVITY_COLS = [
  'prompts', 'promptChars', 'meanPromptChars', 'commandPrompts', 'accepts', 'rejects', 'regenerations',
  'conflicts', 'conflictOverrides', 'reverts', 'overlapWarnings', 'copies', 'pastes', 'pasteChars',
  'manualEditChars', 'aiErrors', 'meanLatencyMs',
] as const;

/** One row per participant with team-level measures repeated (long format for analysis). */
export function summaryCsv(exp: SessionExport): string {
  const s = exp.summary;
  const rows = s.participants.map((p) => {
    const row: Record<string, CsvValue> = {
      room: exp.room, session: s.sessionId, task: s.task, condition: s.condition, participant: p.participantId, name: p.name,
      team_taskTimeSec: s.taskTimeSec, team_unintendedChangeChars: s.unintendedChangeChars, team_intendedChangeChars: s.intendedChangeChars,
    };
    for (const k of ACTIVITY_COLS) row[k] = p[k];
    row.q_control = p.questionnaire?.control ?? null;
    row.q_transparency = p.questionnaire?.transparency ?? null;
    row.q_coordination = p.questionnaire?.coordination ?? null;
    row.q_tlxRaw = p.questionnaire?.tlxRaw ?? null;
    return row;
  });
  return toCsv(rows);
}

export function questionnairesCsv(exp: SessionExport): string {
  const rows = exp.questionnaires.map((q) => {
    const row: Record<string, CsvValue> = {
      room: exp.room, session: exp.meta.sessionId, task: q.task, condition: q.condition, participant: q.participantId,
      name: q.name, role: q.role, submitted_iso: new Date(q.submittedAt).toISOString(),
    };
    for (const i of LIKERT_ITEMS) row[`likert_${i.id}`] = q.likert[i.id];
    for (const t of TLX_SCALES) row[`tlx_${t.id}`] = q.tlx[t.id];
    row.comment = q.comment;
    return row;
  });
  const cols = ['room', 'session', 'task', 'condition', 'participant', 'name', 'role', 'submitted_iso',
    ...LIKERT_ITEMS.map((i) => `likert_${i.id}`), ...TLX_SCALES.map((t) => `tlx_${t.id}`), 'comment'];
  return toCsv(rows, cols);
}
