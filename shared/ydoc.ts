/**
 * Shape of the shared Y.Doc of one study room (one pair, one task, one
 * condition) and the operations every client performs on it.
 *
 * All functions are pure Yjs operations so they can be unit-tested in Node and
 * reused by the server (seeding, export).
 */
import * as Y from 'yjs';
import type {
  AIRequestRecord,
  Condition,
  LogEvent,
  LogEventType,
  QuestionnaireResponse,
  Requester,
  SavedCommand,
  SessionMeta,
  SuggestionVersion,
  RosterEntry,
} from './types';
import { checkAnchor, createAnchor, replaceRange, type AnchorCheck } from './anchors';
import { classifyScope } from './scope';
import { extractContext } from './prompts';
import { scopedChanges } from './diff';

/** Transaction origin for edits made by accepting/reverting AI suggestions. */
export const ORIGIN_AI = 'collab-directgpt:ai';
/** Transaction origin for bookkeeping (requests, log, meta). */
export const ORIGIN_META = 'collab-directgpt:meta';
/** Transaction origin for server-side seeding. */
export const ORIGIN_SEED = 'collab-directgpt:seed';

export interface RoomParts {
  text: Y.Text;
  requests: Y.Map<AIRequestRecord>;
  events: Y.Array<LogEvent>;
  meta: Y.Map<unknown>;
  commands: Y.Array<SavedCommand>;
  questionnaires: Y.Array<QuestionnaireResponse>;
  /** Everyone who has joined the room (any number of participants), keyed by participant id. */
  participants: Y.Map<RosterEntry>;
}

export function roomParts(doc: Y.Doc): RoomParts {
  return {
    text: doc.getText('content'),
    requests: doc.getMap<AIRequestRecord>('requests'),
    events: doc.getArray<LogEvent>('events'),
    meta: doc.getMap<unknown>('meta'),
    commands: doc.getArray<SavedCommand>('commands'),
    questionnaires: doc.getArray<QuestionnaireResponse>('questionnaires'),
    participants: doc.getMap<RosterEntry>('participants'),
  };
}

/** Strip undefined fields so records stay plain JSON inside Yjs. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let idCounter = 0;
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

// ---------------------------------------------------------------- roster

/**
 * Add (or refresh) a participant in the room roster. The first join time is
 * kept, so the join order, and therefore each person's colour, is stable.
 */
export function registerParticipant(
  doc: Y.Doc,
  entry: { participantId: string; name: string; role: string | null },
  now: number = Date.now(),
): RosterEntry {
  const { participants } = roomParts(doc);
  const prev = participants.get(entry.participantId);
  const next: RosterEntry = {
    participantId: entry.participantId,
    name: entry.name,
    role: entry.role,
    joinedAt: prev ? prev.joinedAt : now,
    lastSeenAt: now,
  };
  doc.transact(() => participants.set(entry.participantId, plain(next)), ORIGIN_META);
  return next;
}

/** Roster in join order (ties broken by participant id, so every client agrees). */
export function listRoster(doc: Y.Doc): RosterEntry[] {
  return Array.from(roomParts(doc).participants.values())
    .map((e) => ({ ...e }))
    .sort((a, b) => a.joinedAt - b.joinedAt || a.participantId.localeCompare(b.participantId));
}

/** 0-based join position of a participant (-1 if not in the roster). */
export function rosterIndex(doc: Y.Doc, participantId: string): number {
  return listRoster(doc).findIndex((e) => e.participantId === participantId);
}

// ---------------------------------------------------------------- meta / seeding

export function readMeta(doc: Y.Doc): SessionMeta | null {
  const meta = roomParts(doc).meta;
  if (meta.get('seededAt') === undefined) return null;
  return meta.toJSON() as SessionMeta;
}

/** Insert the task text once (done by the server when a room is created). */
export function seedRoom(doc: Y.Doc, meta: Omit<SessionMeta, 'seededAt'>, now: number = Date.now()): boolean {
  const parts = roomParts(doc);
  if (parts.meta.get('seededAt') !== undefined) return false;
  doc.transact(() => {
    if (parts.text.length === 0) parts.text.insert(0, meta.initialText);
    parts.meta.set('sessionId', meta.sessionId);
    parts.meta.set('task', meta.task);
    parts.meta.set('condition', meta.condition);
    parts.meta.set('initialText', meta.initialText);
    parts.meta.set('seededAt', now);
  }, ORIGIN_SEED);
  return true;
}

export function startTask(doc: Y.Doc, by: string, now: number = Date.now()): boolean {
  const { meta } = roomParts(doc);
  if (meta.get('taskStartedAt') !== undefined) return false;
  doc.transact(() => {
    meta.set('taskStartedAt', now);
    meta.set('taskStartedBy', by);
  }, ORIGIN_META);
  return true;
}

export function endTask(doc: Y.Doc, by: string, now: number = Date.now()): boolean {
  const { meta } = roomParts(doc);
  if (meta.get('taskStartedAt') === undefined || meta.get('taskEndedAt') !== undefined) return false;
  doc.transact(() => {
    meta.set('taskEndedAt', now);
    meta.set('taskEndedBy', by);
  }, ORIGIN_META);
  return true;
}

// ---------------------------------------------------------------- logging

export interface LogContext {
  participantId: string;
  name: string;
  condition: Condition;
  task: string;
}

export function logEvent(
  doc: Y.Doc,
  ctx: LogContext,
  type: LogEventType,
  data: LogEvent['data'] = {},
  now: number = Date.now(),
): LogEvent {
  const event: LogEvent = {
    id: makeId('ev'),
    t: now,
    type,
    participantId: ctx.participantId,
    name: ctx.name,
    condition: ctx.condition,
    task: ctx.task,
    data,
  };
  doc.transact(() => roomParts(doc).events.push([plain(event)]), ORIGIN_META);
  return event;
}

// ---------------------------------------------------------------- requests

export function getRequest(doc: Y.Doc, id: string): AIRequestRecord | undefined {
  const r = roomParts(doc).requests.get(id);
  return r ? (plain(r) as AIRequestRecord) : undefined;
}

export function listRequests(doc: Y.Doc): AIRequestRecord[] {
  return Array.from(roomParts(doc).requests.values())
    .map((r) => plain(r) as AIRequestRecord)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function putRequest(doc: Y.Doc, record: AIRequestRecord): AIRequestRecord {
  const clean = plain(record);
  doc.transact(() => roomParts(doc).requests.set(record.id, clean), ORIGIN_META);
  return clean;
}

export interface CreateRequestInput {
  id?: string;
  requester: Requester;
  commandId: string;
  commandLabel: string;
  instruction: string;
  typedChars: number;
  from: number;
  to: number;
  now?: number;
}

export function createRequest(doc: Y.Doc, input: CreateRequestInput): AIRequestRecord {
  const { text } = roomParts(doc);
  const full = text.toString();
  const from = Math.max(0, Math.min(input.from, input.to));
  const to = Math.min(full.length, Math.max(input.from, input.to));
  if (to <= from) throw new Error('Select some text before asking the AI to edit it.');
  const now = input.now ?? Date.now();
  const ctx = extractContext(full, from, to);
  const record: AIRequestRecord = {
    id: input.id ?? makeId('req'),
    requester: input.requester,
    commandId: input.commandId,
    commandLabel: input.commandLabel,
    instruction: input.instruction,
    typedChars: input.typedChars,
    scope: classifyScope(full, { from, to }),
    anchor: createAnchor(text, from, to),
    originalText: full.slice(from, to),
    contextBefore: ctx.before,
    contextAfter: ctx.after,
    versions: [],
    activeVersion: 0,
    status: 'generating',
    createdAt: now,
    updatedAt: now,
  };
  return putRequest(doc, record);
}

/** Store an LLM suggestion. The request becomes pending, or conflicted if its text changed meanwhile. */
export function addSuggestion(doc: Y.Doc, id: string, version: SuggestionVersion, now: number = Date.now()): AIRequestRecord {
  const r = getRequest(doc, id);
  if (!r) throw new Error(`Unknown request ${id}`);
  // A late answer for a request that was cancelled/rejected meanwhile is dropped.
  if (r.status !== 'generating') return r;
  const { text } = roomParts(doc);
  r.versions.push(version);
  r.activeVersion = r.versions.length - 1;
  r.error = undefined;
  r.updatedAt = now;
  const check = checkAnchor(doc, text, r.anchor, r.originalText);
  if (check.state === 'ok') {
    r.status = 'pending';
    r.conflict = undefined;
  } else {
    r.status = 'conflicted';
    r.conflict = { detectedAt: now, kind: check.state, currentText: check.currentText };
  }
  return putRequest(doc, r);
}

export function failRequest(doc: Y.Doc, id: string, error: string, now: number = Date.now()): AIRequestRecord | undefined {
  const r = getRequest(doc, id);
  if (!r) return undefined;
  if (r.status !== 'generating') return r;
  // Keep previous versions reviewable if a regeneration fails.
  if (r.versions.length > 0) {
    r.status = 'pending';
    const check = checkAnchor(doc, roomParts(doc).text, r.anchor, r.originalText);
    if (check.state !== 'ok') {
      r.status = 'conflicted';
      r.conflict = { detectedAt: now, kind: check.state, currentText: check.currentText };
    }
  } else {
    r.status = 'failed';
  }
  r.error = error;
  r.updatedAt = now;
  return putRequest(doc, r);
}

/**
 * Prepare a new version. With `rebase` (used after a conflict) the request is
 * re-anchored on the text currently in the range so the LLM works on it.
 * Returns the variant number to send to the LLM.
 */
export function beginRegeneration(
  doc: Y.Doc,
  id: string,
  opts: { rebase?: boolean } = {},
  now: number = Date.now(),
): { record: AIRequestRecord; variant: number } {
  const r = getRequest(doc, id);
  if (!r) throw new Error(`Unknown request ${id}`);
  if (!['pending', 'conflicted', 'failed'].includes(r.status)) {
    throw new Error(`Cannot regenerate a request that is ${r.status}.`);
  }
  const { text } = roomParts(doc);
  if (opts.rebase || r.status === 'conflicted') {
    const check = checkAnchor(doc, text, r.anchor, r.originalText);
    if (check.state === 'deleted') throw new Error('The selected text was deleted; this request can only be rejected.');
    const full = text.toString();
    const ctx = extractContext(full, check.from, check.to);
    r.anchor = createAnchor(text, check.from, check.to);
    r.originalText = check.currentText;
    r.contextBefore = ctx.before;
    r.contextAfter = ctx.after;
    r.scope = classifyScope(full, { from: check.from, to: check.to });
    r.conflict = undefined;
  }
  r.status = 'generating';
  r.error = undefined;
  r.updatedAt = now;
  return { record: putRequest(doc, r), variant: r.versions.length };
}

export function selectVersion(doc: Y.Doc, id: string, index: number): AIRequestRecord | undefined {
  const r = getRequest(doc, id);
  if (!r || index < 0 || index >= r.versions.length) return r;
  r.activeVersion = index;
  return putRequest(doc, r);
}

export type DecisionResult =
  | {
      ok: true;
      record: AIRequestRecord;
      /** Characters changed inside the anchored selection. */
      changedInside: number;
      /** Characters changed anywhere else in the document (should always be 0). */
      changedOutside: number;
    }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'conflict' | 'deleted'; record?: AIRequestRecord; check?: AnchorCheck };

function markConflict(doc: Y.Doc, r: AIRequestRecord, check: AnchorCheck, now: number): AIRequestRecord {
  r.status = 'conflicted';
  r.conflict = { detectedAt: now, kind: check.state === 'deleted' ? 'deleted' : 'changed', currentText: check.currentText };
  r.updatedAt = now;
  return putRequest(doc, r);
}

/**
 * Apply the active suggestion to exactly the anchored range (Figure 1,
 * step 7). If the anchored text changed since the request, the request is
 * flagged as conflicted and nothing is applied unless `force` is set.
 */
export function acceptRequest(
  doc: Y.Doc,
  id: string,
  by: string,
  opts: { force?: boolean } = {},
  now: number = Date.now(),
): DecisionResult {
  const r = getRequest(doc, id);
  if (!r) return { ok: false, reason: 'not_found' };
  if (r.status !== 'pending' && r.status !== 'conflicted') return { ok: false, reason: 'invalid_status', record: r };
  const suggestion = r.versions[r.activeVersion]?.text;
  if (suggestion === undefined) return { ok: false, reason: 'invalid_status', record: r };
  const { text } = roomParts(doc);
  const check = checkAnchor(doc, text, r.anchor, r.originalText);
  if (check.state === 'deleted') return { ok: false, reason: 'deleted', record: markConflict(doc, r, check, now), check };
  if (check.state === 'changed' && !opts.force) {
    return { ok: false, reason: 'conflict', record: markConflict(doc, r, check, now), check };
  }
  const before = text.toString();
  let record = r;
  doc.transact(() => {
    replaceRange(text, check.from, check.to, suggestion);
    record = {
      ...r,
      status: 'accepted',
      decidedAt: now,
      decidedBy: by,
      updatedAt: now,
      conflict: undefined,
      applied: {
        anchor: createAnchor(text, check.from, check.from + suggestion.length),
        text: suggestion,
        beforeText: check.currentText,
        at: now,
        by,
        conflictOverride: check.state === 'changed',
      },
    };
    roomParts(doc).requests.set(id, plain(record));
  }, ORIGIN_AI);
  const after = text.toString();
  const changes = scopedChanges(before, after, [{ from: check.from, to: check.to }]);
  return { ok: true, record: plain(record), changedInside: changes.inside, changedOutside: changes.outside };
}

export function rejectRequest(doc: Y.Doc, id: string, by: string, now: number = Date.now()): DecisionResult {
  const r = getRequest(doc, id);
  if (!r) return { ok: false, reason: 'not_found' };
  if (!['pending', 'conflicted', 'failed', 'generating'].includes(r.status)) {
    return { ok: false, reason: 'invalid_status', record: r };
  }
  r.status = 'rejected';
  r.decidedAt = now;
  r.decidedBy = by;
  r.updatedAt = now;
  return { ok: true, record: putRequest(doc, r), changedInside: 0, changedOutside: 0 };
}

/**
 * Undo an accepted AI edit from the shared history: the inserted text is
 * replaced by the text it originally replaced. If someone edited the inserted
 * text since, a conflict is reported unless `force` is set.
 */
export function revertRequest(
  doc: Y.Doc,
  id: string,
  by: string,
  opts: { force?: boolean } = {},
  now: number = Date.now(),
): DecisionResult {
  const r = getRequest(doc, id);
  if (!r) return { ok: false, reason: 'not_found' };
  if (r.status !== 'accepted' || !r.applied) return { ok: false, reason: 'invalid_status', record: r };
  const applied = r.applied;
  const { text } = roomParts(doc);
  const check = checkAnchor(doc, text, applied.anchor, applied.text);
  if (check.state !== 'ok' && !opts.force) {
    return { ok: false, reason: check.state === 'deleted' && applied.text.length > 0 ? 'deleted' : 'conflict', record: r, check };
  }
  const before = text.toString();
  let record = r;
  doc.transact(() => {
    replaceRange(text, check.from, check.to, applied.beforeText);
    record = { ...r, status: 'reverted', revertedAt: now, revertedBy: by, updatedAt: now };
    roomParts(doc).requests.set(id, plain(record));
  }, ORIGIN_AI);
  const changes = scopedChanges(before, text.toString(), [{ from: check.from, to: check.to }]);
  return { ok: true, record: plain(record), changedInside: changes.inside, changedOutside: changes.outside };
}

export interface ConflictTransition {
  id: string;
  from: AIRequestRecord['status'];
  to: AIRequestRecord['status'];
  check: AnchorCheck;
}

/**
 * Re-check every reviewable request after the document changed (Figure 1,
 * step 9). Pending requests whose text changed become conflicted; conflicted
 * requests whose text went back to the original become pending again. Only
 * requests accepted by `owns` are written (each requester's client is
 * responsible for its own requests, so collaborators do not race).
 */
export function refreshConflicts(
  doc: Y.Doc,
  owns: (r: AIRequestRecord) => boolean,
  now: number = Date.now(),
): ConflictTransition[] {
  const { text } = roomParts(doc);
  const transitions: ConflictTransition[] = [];
  for (const r of listRequests(doc)) {
    if (!owns(r) || (r.status !== 'pending' && r.status !== 'conflicted')) continue;
    const check = checkAnchor(doc, text, r.anchor, r.originalText);
    if (r.status === 'pending' && check.state !== 'ok') {
      markConflict(doc, r, check, now);
      transitions.push({ id: r.id, from: 'pending', to: 'conflicted', check });
    } else if (r.status === 'conflicted' && check.state === 'ok') {
      putRequest(doc, { ...r, status: 'pending', conflict: undefined, updatedAt: now });
      transitions.push({ id: r.id, from: 'conflicted', to: 'pending', check });
    } else if (r.status === 'conflicted' && r.conflict && r.conflict.currentText !== check.currentText) {
      putRequest(doc, {
        ...r,
        conflict: { detectedAt: r.conflict.detectedAt, kind: check.state === 'deleted' ? 'deleted' : 'changed', currentText: check.currentText },
        updatedAt: now,
      });
    }
  }
  return transitions;
}

/** Live check used for display by every client (does not write). */
export function liveCheck(doc: Y.Doc, r: AIRequestRecord): AnchorCheck {
  return checkAnchor(doc, roomParts(doc).text, r.anchor, r.originalText);
}

/**
 * Requests of a requester stuck in "generating" because the tab that issued
 * them was closed or reloaded (their client id differs from the current one).
 */
export function failStaleGenerations(
  doc: Y.Doc,
  participantId: string,
  olderThanMs: number,
  now: number = Date.now(),
  currentClientId: number | null = null,
): number {
  let n = 0;
  for (const r of listRequests(doc)) {
    if (
      r.requester.participantId === participantId &&
      r.status === 'generating' &&
      now - r.updatedAt >= olderThanMs &&
      r.requester.clientId !== currentClientId
    ) {
      failRequest(doc, r.id, 'The AI request was interrupted (page reloaded). Regenerate or reject it.', now);
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- toolbar & questionnaires

export function saveCommand(doc: Y.Doc, cmd: Omit<SavedCommand, 'id' | 'createdAt'>, now: number = Date.now()): SavedCommand {
  const saved: SavedCommand = { ...cmd, id: makeId('cmd'), createdAt: now };
  doc.transact(() => roomParts(doc).commands.push([plain(saved)]), ORIGIN_META);
  return saved;
}

export function submitQuestionnaire(doc: Y.Doc, response: QuestionnaireResponse): void {
  doc.transact(() => roomParts(doc).questionnaires.push([plain(response)]), ORIGIN_META);
}
