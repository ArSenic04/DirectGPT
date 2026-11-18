/**
 * Study measures computed from a room's log (Figure 1, step 9 "collects
 * collaboration and usability measures").
 */
import type { Condition, LogEvent, QuestionnaireResponse, SessionMeta } from './types';
import { scopedChanges, type Span } from './diff';
import { scoreQuestionnaire, type QuestionnaireScores } from './questionnaire';

export interface ActivityCounts {
  /** AI requests (direct) or chat messages (baseline). */
  prompts: number;
  /** Characters typed into prompts (toolbar commands count 0). */
  promptChars: number;
  meanPromptChars: number | null;
  /** Prompts that used a toolbar command rather than typed text. */
  commandPrompts: number;
  accepts: number;
  rejects: number;
  regenerations: number;
  conflicts: number;
  conflictOverrides: number;
  reverts: number;
  overlapWarnings: number;
  copies: number;
  pastes: number;
  pasteChars: number;
  manualEditChars: number;
  aiErrors: number;
  meanLatencyMs: number | null;
}

export interface ParticipantSummary extends ActivityCounts {
  participantId: string;
  name: string;
  questionnaire: QuestionnaireScores | null;
}

export interface SessionSummary extends ActivityCounts {
  sessionId: string;
  task: string;
  condition: Condition;
  taskTimeSec: number | null;
  /** Characters changed inside the task's target passages (final vs initial). */
  intendedChangeChars: number | null;
  /** Characters changed outside the task's target passages: unintended modifications. */
  unintendedChangeChars: number | null;
  participants: ParticipantSummary[];
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function countActivity(events: LogEvent[]): ActivityCounts {
  const c: ActivityCounts = {
    prompts: 0, promptChars: 0, meanPromptChars: null, commandPrompts: 0, accepts: 0, rejects: 0,
    regenerations: 0, conflicts: 0, conflictOverrides: 0, reverts: 0, overlapWarnings: 0, copies: 0,
    pastes: 0, pasteChars: 0, manualEditChars: 0, aiErrors: 0, meanLatencyMs: null,
  };
  const latencies: number[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'ai_request':
        c.prompts++;
        c.promptChars += num(e.data.typedChars);
        if (num(e.data.typedChars) === 0) c.commandPrompts++;
        break;
      case 'chat_message':
        c.prompts++;
        c.promptChars += num(e.data.typedChars);
        break;
      case 'ai_response':
      case 'chat_response':
        latencies.push(num(e.data.latencyMs));
        break;
      case 'accept':
        c.accepts++;
        if (e.data.conflictOverride === true) c.conflictOverrides++;
        break;
      case 'reject': c.rejects++; break;
      case 'regenerate': c.regenerations++; break;
      case 'conflict_detected': c.conflicts++; break;
      case 'revert': c.reverts++; break;
      case 'overlap_warning': c.overlapWarnings++; break;
      case 'copy_response': c.copies++; break;
      case 'paste':
        c.pastes++;
        c.pasteChars += num(e.data.length);
        break;
      case 'manual_edit':
        c.manualEditChars += num(e.data.inserted) + num(e.data.deleted);
        break;
      case 'ai_error':
      case 'chat_error':
        c.aiErrors++;
        break;
      default:
        break;
    }
  }
  c.meanPromptChars = c.prompts > 0 ? c.promptChars / c.prompts : null;
  c.meanLatencyMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  return c;
}

export interface SummaryInput {
  meta: SessionMeta;
  events: LogEvent[];
  questionnaires: QuestionnaireResponse[];
  finalText: string;
  /** Intended scope in the initial text; null when the task has no targets. */
  targets: Span[] | null;
}

export function summarizeSession(input: SummaryInput): SessionSummary {
  const { meta, events, questionnaires, finalText, targets } = input;
  const team = countActivity(events);
  const ids: string[] = [];
  for (const e of events) if (!ids.includes(e.participantId)) ids.push(e.participantId);
  for (const q of questionnaires) if (!ids.includes(q.participantId)) ids.push(q.participantId);
  const participants: ParticipantSummary[] = ids.map((pid) => {
    const own = events.filter((e) => e.participantId === pid);
    const q = [...questionnaires].reverse().find((r) => r.participantId === pid);
    return {
      participantId: pid,
      name: own[0]?.name ?? q?.name ?? pid,
      ...countActivity(own),
      questionnaire: q ? scoreQuestionnaire(q.likert, q.tlx) : null,
    };
  });
  const changes = targets && targets.length > 0 ? scopedChanges(meta.initialText, finalText, targets) : null;
  const taskTimeSec =
    meta.taskStartedAt !== undefined && meta.taskEndedAt !== undefined
      ? Math.round((meta.taskEndedAt - meta.taskStartedAt) / 100) / 10
      : null;
  return {
    sessionId: meta.sessionId,
    task: meta.task,
    condition: meta.condition,
    taskTimeSec,
    intendedChangeChars: changes ? changes.inside : null,
    unintendedChangeChars: changes ? changes.outside : null,
    ...team,
    participants,
  };
}
