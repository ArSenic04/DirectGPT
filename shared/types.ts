/**
 * Shared data model for Collaborative DirectGPT.
 *
 * Everything that lives in the shared Y.Doc is plain JSON so it can be stored
 * in Y.Map / Y.Array values, exported as-is, and read by the analysis script.
 */

export type Condition = 'direct' | 'baseline';

export const CONDITIONS: readonly Condition[] = ['direct', 'baseline'];

export const CONDITION_LABELS: Record<Condition, string> = {
  direct: 'Direct manipulation (Collaborative DirectGPT)',
  baseline: 'Baseline (prompt-based chat)',
};

export interface Participant {
  /** Study participant identifier, e.g. "P03". */
  participantId: string;
  /** Display name shown to collaborators. */
  name: string;
  /** Presence colour (hex). */
  color: string;
  /** Lighter version of the colour, used for highlights. */
  colorLight: string;
  /** Partner role inside the pair ("A" or "B"), decides which task items are shown. */
  role: 'A' | 'B';
}

/** Y.RelativePosition serialised with Y.relativePositionToJSON. */
export type RelPosJSON = Record<string, unknown>;

export interface Anchor {
  start: RelPosJSON;
  end: RelPosJSON;
}

export type ScopeKind = 'span' | 'sentence' | 'paragraph' | 'section' | 'document';

/**
 * Status of an AI edit request (Figure 1, steps 5–9).
 * - generating: the LLM is processing the request
 * - pending: a suggestion is ready and waits for the requester's decision
 * - accepted / rejected: the requester decided
 * - conflicted: the anchored text changed after the request was made
 * - reverted: an accepted edit was undone from the history panel
 * - failed: the LLM call failed (bad key, network, ...)
 */
export type RequestStatus =
  | 'generating'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'conflicted'
  | 'reverted'
  | 'failed';

export const ACTIVE_STATUSES: readonly RequestStatus[] = ['generating', 'pending', 'conflicted'];

export interface SuggestionVersion {
  text: string;
  provider: LLMProviderId;
  model: string;
  createdAt: number;
  latencyMs: number;
}

export interface Requester {
  participantId: string;
  name: string;
  color: string;
  clientId: number;
}

export interface ConflictInfo {
  detectedAt: number;
  /** "changed": text inside the anchors differs; "deleted": the anchored range is gone. */
  kind: 'changed' | 'deleted';
  currentText: string;
}

export interface AppliedInfo {
  anchor: Anchor;
  /** The text that was inserted (the accepted suggestion). */
  text: string;
  /** The text that was replaced (used for revert). */
  beforeText: string;
  at: number;
  by: string;
  /** True when the requester applied the suggestion despite a conflict. */
  conflictOverride: boolean;
}

export interface AIRequestRecord {
  id: string;
  requester: Requester;
  commandId: string;
  commandLabel: string;
  instruction: string;
  /** Characters typed by the user for this request (0 for toolbar commands). */
  typedChars: number;
  scope: ScopeKind;
  anchor: Anchor;
  originalText: string;
  contextBefore: string;
  contextAfter: string;
  versions: SuggestionVersion[];
  activeVersion: number;
  status: RequestStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  decidedBy?: string;
  conflict?: ConflictInfo;
  applied?: AppliedInfo;
  revertedAt?: number;
  revertedBy?: string;
}

export interface SavedCommand {
  id: string;
  label: string;
  instruction: string;
  createdBy: string;
  createdAt: number;
}

export type LogEventType =
  | 'session_join'
  | 'session_leave'
  | 'task_start'
  | 'task_end'
  | 'ai_request'
  | 'ai_response'
  | 'ai_error'
  | 'preview_open'
  | 'accept'
  | 'reject'
  | 'regenerate'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'conflict_override'
  | 'revert'
  | 'overlap_warning'
  | 'command_saved'
  | 'chat_message'
  | 'chat_response'
  | 'chat_error'
  | 'copy_response'
  | 'paste'
  | 'manual_edit'
  | 'questionnaire_submit'
  | 'export';

export interface LogEvent {
  id: string;
  t: number;
  type: LogEventType;
  participantId: string;
  name: string;
  condition: Condition;
  task: string;
  data: Record<string, string | number | boolean | null>;
}

export type LLMProviderId = 'mock' | 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ScopedLLMRequest {
  kind: 'scoped';
  commandId: string;
  instruction: string;
  selection: string;
  contextBefore: string;
  contextAfter: string;
  /** 0 for the first suggestion, incremented for every regeneration. */
  variant: number;
}

export interface ChatLLMRequest {
  kind: 'chat';
  /** Full current document: the baseline assistant always sees all of it. */
  document: string;
  messages: ChatMessage[];
}

export type LLMRequest = ScopedLLMRequest | ChatLLMRequest;

export interface LLMCallBody {
  provider: LLMProviderId;
  model?: string;
  request: LLMRequest;
}

export interface LLMResult {
  text: string;
  provider: LLMProviderId;
  model: string;
  latencyMs: number;
}

export interface LLMErrorBody {
  error: string;
  code: 'bad_request' | 'no_key' | 'auth' | 'rate_limit' | 'provider_error' | 'network' | 'timeout';
}

/**
 * Body of a /api/llm answer. Provider-side failures (no key, bad key, rate
 * limit, network, timeout) are answered with HTTP 200 and ok: false: they are
 * expected outcomes shown in the UI, not transport errors (this also keeps
 * the browser console free of "failed to load resource" noise). Malformed
 * requests still get HTTP 4xx.
 */
export type LLMResponse = ({ ok: true } & LLMResult) | ({ ok: false } & LLMErrorBody);

export interface ServerConfig {
  serverKeyConfigured: boolean;
  defaultModel: string;
  baseUrlHost: string;
  mockLatencyMs: number;
}

export interface SessionMeta {
  sessionId: string;
  task: string;
  condition: Condition;
  initialText: string;
  seededAt: number;
  taskStartedAt?: number;
  taskStartedBy?: string;
  taskEndedAt?: number;
  taskEndedBy?: string;
}

export interface QuestionnaireResponse {
  id: string;
  participantId: string;
  name: string;
  role: 'A' | 'B';
  condition: Condition;
  task: string;
  submittedAt: number;
  likert: Record<string, number>;
  tlx: Record<string, number>;
  comment: string;
}
