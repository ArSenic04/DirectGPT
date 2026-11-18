/**
 * The collaborative workspace for one room: wires the shared Y.Doc to the
 * editor, the direct-manipulation panel (or the baseline chat), presence,
 * history, conflict detection and study logging.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { AIRequestRecord, LLMCallBody, LogEvent, Participant, QuestionnaireResponse, SavedCommand, SessionMeta } from '../../shared/types';
import { ACTIVE_STATUSES, CONDITION_LABELS } from '../../shared/types';
import type { TaskDefinition } from '../../shared/tasks';
import type { CommandDefinition } from '../../shared/commands';
import { rangesOverlap, resolveAnchor, type AnchorCheck } from '../../shared/anchors';
import { classifyScope, expandToParagraphs, expandToSentences } from '../../shared/scope';
import { scoreQuestionnaire } from '../../shared/questionnaire';
import {
  ORIGIN_AI, ORIGIN_SEED, acceptRequest, addSuggestion, beginRegeneration, createRequest, endTask, failRequest,
  failStaleGenerations, liveCheck, logEvent, makeId, readMeta, refreshConflicts, rejectRequest, revertRequest,
  saveCommand, selectVersion, startTask, submitQuestionnaire, type LogContext,
} from '../../shared/ydoc';
import { useRequests, usePresence, useTextVersion, useYSnapshot, type CollabConnection, type PresenceActivity } from './hooks';
import { callLLM, LLMClientError } from './llmClient';
import { useSettings } from './settings';
import { Editor, type EditorApi, type RequestMark } from './components/Editor';
import { DirectPanel, type SelectionInfo } from './components/DirectPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ChatPanel, type ChatEntry } from './components/ChatPanel';
import { PresenceBar } from './components/PresenceBar';
import { TaskPanel } from './components/TaskPanel';
import { Questionnaire } from './components/Questionnaire';
import { ExportMenu, LLMSettings } from './components/SettingsMenu';
import type { RequestActions } from './components/PreviewCard';
import { formatTime } from './components/StatusBadge';
import type { SessionParams } from './params';
import { copyableText } from './copyable';

interface Props {
  conn: CollabConnection;
  params: SessionParams;
  me: Participant;
  task: TaskDefinition;
  room: string;
}

const MANUAL_EDIT_FLUSH_MS = 3000;

function errorMessage(err: unknown): { code: string; message: string } {
  if (err instanceof LLMClientError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'error', message: err.message };
  return { code: 'error', message: String(err) };
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function Workspace({ conn, params, me, task, room }: Props) {
  const { doc, parts, provider } = conn;
  const awareness = provider.awareness;
  const settings = useSettings();
  const isDirect = params.condition === 'direct';
  const isStudyTask = task.items.length > 0;

  const requests = useRequests(parts);
  const text = useTextVersion(parts.text);
  const meta = useYSnapshot(parts.meta as unknown as Y.AbstractType<unknown>, () => readMeta(doc)) as SessionMeta | null;
  const savedCommands = useYSnapshot(parts.commands as unknown as Y.AbstractType<unknown>, () => parts.commands.toArray() as SavedCommand[]);
  const questionnaires = useYSnapshot(parts.questionnaires as unknown as Y.AbstractType<unknown>, () => parts.questionnaires.toArray() as QuestionnaireResponse[]);
  const events = useYSnapshot(parts.events as unknown as Y.AbstractType<unknown>, () => parts.events.toArray() as LogEvent[]);
  const presence = usePresence(awareness);
  const duplicatePid = presence.some((p) => !p.isLocal && p.user.participantId === me.participantId);

  const editorApi = useRef<EditorApi>(null);
  const undoManager = useMemo(() => new Y.UndoManager(parts.text), [parts.text]);
  useEffect(() => () => undoManager.destroy(), [undoManager]);

  const [selection, setSelection] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const [tab, setTab] = useState<'edit' | 'history'>('edit');
  const [toast, setToast] = useState<string | null>(null);
  const [showProvenance, setShowProvenance] = useState(true);
  const [revertConflicts, setRevertConflicts] = useState<Record<string, string>>({});
  const chatKey = `cdg-chat:${room}:${me.participantId}`;
  const [chat, setChat] = useState<ChatEntry[]>(() => {
    try {
      const raw = sessionStorage.getItem(chatKey);
      return raw ? (JSON.parse(raw) as ChatEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [chatBusy, setChatBusy] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const started = meta?.taskStartedAt !== undefined;
  const ended = meta?.taskEndedAt !== undefined;
  const taskActive = !isStudyTask || (started && !ended);
  const disabledReason = !isStudyTask ? null : !started ? 'Press “Start task” (left) to begin.' : ended ? 'The task is finished.' : null;

  const logCtx: LogContext = useMemo(
    () => ({ participantId: me.participantId, name: me.name, condition: params.condition, task: params.task }),
    [me.participantId, me.name, params.condition, params.task],
  );
  const log = useCallback((type: LogEvent['type'], data: LogEvent['data'] = {}) => logEvent(doc, logCtx, type, data), [doc, logCtx]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 4500);
  }, []);

  // Join: log, and clean up requests left "generating" by a previous tab of mine.
  useEffect(() => {
    failStaleGenerations(doc, me.participantId, 0, Date.now(), doc.clientID);
    log('session_join', { role: me.role, provider: settings.provider, model: settings.provider === 'mock' ? 'mock-deterministic' : settings.model });
    const onLeave = () => log('session_leave', {});
    window.addEventListener('pagehide', onLeave);
    return () => window.removeEventListener('pagehide', onLeave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    try {
      sessionStorage.setItem(chatKey, JSON.stringify(chat));
    } catch {
      /* storage full or disabled: chat simply is not restored after reload */
    }
  }, [chat, chatKey]);

  // ---------------------------------------------------------------- live conflict detection (step 9)
  useEffect(() => {
    let timer: number | null = null;
    const run = () => {
      timer = null;
      const transitions = refreshConflicts(doc, (r) => r.requester.participantId === me.participantId);
      for (const t of transitions) {
        if (t.to === 'conflicted') {
          log('conflict_detected', { requestId: t.id, kind: t.check.state, via: 'live' });
          notify('A collaborator changed text you asked the AI to edit. Review the conflict in the AI panel.');
        } else {
          log('conflict_resolved', { requestId: t.id, action: 'restored' });
        }
      }
    };
    const observer = () => {
      if (timer === null) timer = window.setTimeout(run, 120);
    };
    parts.text.observe(observer);
    return () => {
      parts.text.unobserve(observer);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [doc, parts.text, me.participantId, log, notify]);

  // ---------------------------------------------------------------- manual edit tracking
  useEffect(() => {
    let inserted = 0;
    let deleted = 0;
    const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
      if (!tr.local || tr.origin === ORIGIN_AI || tr.origin === ORIGIN_SEED) return;
      for (const d of event.delta) {
        if (typeof d.insert === 'string') inserted += d.insert.length;
        if (typeof d.delete === 'number') deleted += d.delete;
      }
    };
    const flush = () => {
      if (inserted === 0 && deleted === 0) return;
      logEvent(doc, logCtx, 'manual_edit', { inserted, deleted });
      inserted = 0;
      deleted = 0;
    };
    parts.text.observe(observer);
    const interval = window.setInterval(flush, MANUAL_EDIT_FLUSH_MS);
    return () => {
      parts.text.unobserve(observer);
      window.clearInterval(interval);
      flush();
    };
  }, [doc, parts.text, logCtx]);

  // ---------------------------------------------------------------- derived state
  const activeRequests = useMemo(() => requests.filter((r) => ACTIVE_STATUSES.includes(r.status) || r.status === 'failed'), [requests]);

  const resolved = useMemo(() => {
    // Recomputed whenever the text or the requests change.
    void text;
    const map = new Map<string, { from: number; to: number } | null>();
    for (const r of requests) {
      const anchor = r.status === 'accepted' && r.applied ? r.applied.anchor : r.anchor;
      map.set(r.id, resolveAnchor(doc, anchor));
    }
    return map;
  }, [requests, text, doc]);

  const nameOf = useCallback(
    (pid: string) => {
      if (pid === me.participantId) return 'you';
      const p = presence.find((s) => s.user.participantId === pid);
      if (p) return p.user.name;
      const r = requests.find((x) => x.requester.participantId === pid);
      if (r) return r.requester.name;
      return events.find((e) => e.participantId === pid)?.name ?? pid;
    },
    [me.participantId, presence, requests, events],
  );

  const selectionInfo: SelectionInfo | null = useMemo(() => {
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    if (to <= from || to > text.length) return null;
    const overlaps = new Set<string>();
    for (const r of activeRequests) {
      if (r.requester.participantId === me.participantId || r.status === 'failed') continue;
      const range = resolved.get(r.id);
      if (range && rangesOverlap(range, { from, to })) overlaps.add(r.requester.name);
    }
    return { from, to, text: text.slice(from, to), scope: classifyScope(text, { from, to }), overlaps: Array.from(overlaps) };
  }, [selection, text, activeRequests, resolved, me.participantId]);

  const marks: RequestMark[] = useMemo(() => {
    const out: RequestMark[] = [];
    for (const r of requests) {
      const range = resolved.get(r.id);
      if (!range) continue;
      const who = r.requester.participantId === me.participantId ? 'You' : r.requester.name;
      const what = r.commandId === 'custom' ? 'custom' : r.commandLabel;
      if (r.status === 'generating' || r.status === 'pending' || r.status === 'conflicted') {
        const icon = r.status === 'generating' ? '⏳' : r.status === 'conflicted' ? '⚠' : '👁';
        const state = r.status === 'generating' ? 'AI is generating' : r.status === 'conflicted' ? 'conflict' : 'suggestion ready';
        out.push({ id: r.id, from: range.from, to: range.to, color: r.requester.color, kind: r.status, label: `${icon} ${who} · ${what}`, title: `${r.requester.name} asked the AI: ${r.instruction} (${state})` });
      } else if (r.status === 'accepted' && showProvenance && isDirect) {
        out.push({ id: r.id, from: range.from, to: range.to, color: r.requester.color, kind: 'accepted', label: '', title: `AI edit “${what}” requested by ${r.requester.name}, accepted at ${formatTime(r.decidedAt)}` });
      }
    }
    return out;
  }, [requests, resolved, me.participantId, showProvenance, isDirect]);

  // Presence activity shown to collaborators.
  const activity: PresenceActivity = useMemo(() => {
    const mine = activeRequests.filter((r) => r.requester.participantId === me.participantId);
    const generating = mine.find((r) => r.status === 'generating');
    if (generating) return { kind: 'waiting', detail: generating.commandLabel };
    const reviewing = mine.find((r) => r.status === 'pending' || r.status === 'conflicted');
    if (reviewing) return { kind: 'reviewing', detail: reviewing.commandLabel };
    if (chatBusy) return { kind: 'chatting' };
    if (selectionInfo) return { kind: 'selecting', detail: selectionInfo.scope };
    return { kind: 'idle' };
  }, [activeRequests, me.participantId, chatBusy, selectionInfo]);
  useEffect(() => {
    awareness.setLocalStateField('activity', activity);
  }, [awareness, activity]);

  const live = useCallback((r: AIRequestRecord): AnchorCheck | null => {
    void text;
    return r.status === 'pending' || r.status === 'conflicted' || r.status === 'generating' ? liveCheck(doc, r) : null;
  }, [doc, text]);

  // ---------------------------------------------------------------- AI actions (steps 3–8)
  const runLLM = useCallback(
    async (record: AIRequestRecord, variant: number) => {
      const body: LLMCallBody = {
        provider: settings.provider,
        model: settings.provider === 'openai' ? settings.model : undefined,
        request: {
          kind: 'scoped',
          commandId: record.commandId.startsWith('saved:') ? 'custom' : record.commandId,
          instruction: record.instruction,
          selection: record.originalText,
          contextBefore: record.contextBefore,
          contextAfter: record.contextAfter,
          variant,
        },
      };
      try {
        const res = await callLLM(body, settings.apiKey);
        const updated = addSuggestion(doc, record.id, { text: res.text, provider: res.provider, model: res.model, createdAt: Date.now(), latencyMs: res.latencyMs });
        log('ai_response', { requestId: record.id, latencyMs: res.latencyMs, provider: res.provider, model: res.model, variant, outputLength: res.text.length });
        if (updated.status === 'conflicted') log('conflict_detected', { requestId: record.id, kind: updated.conflict?.kind ?? 'changed', via: 'arrival' });
      } catch (err) {
        const { code, message } = errorMessage(err);
        failRequest(doc, record.id, message);
        log('ai_error', { requestId: record.id, code, message });
        notify(message);
      }
    },
    [doc, log, notify, settings.provider, settings.model, settings.apiKey],
  );

  const requestEdit = useCallback(
    (command: CommandDefinition, typedChars: number) => {
      if (!taskActive) return;
      const sel = editorApi.current?.getSelection() ?? selection;
      const from = Math.min(sel.from, sel.to);
      const to = Math.max(sel.from, sel.to);
      if (to <= from) {
        notify('Select some text first.');
        return;
      }
      let record: AIRequestRecord;
      try {
        record = createRequest(doc, {
          requester: { participantId: me.participantId, name: me.name, color: me.color, clientId: doc.clientID },
          commandId: command.id,
          commandLabel: command.label,
          instruction: command.instruction,
          typedChars,
          from,
          to,
        });
      } catch (err) {
        notify(errorMessage(err).message);
        return;
      }
      const overlapping = activeRequests.filter((r) => {
        if (r.requester.participantId === me.participantId || r.status === 'failed') return false;
        const range = resolved.get(r.id);
        return range ? rangesOverlap(range, { from, to }) : false;
      });
      log('ai_request', {
        requestId: record.id, commandId: command.id, typedChars, instructionLength: command.instruction.length,
        selectionLength: to - from, scope: record.scope, overlapsOthers: overlapping.length > 0,
      });
      for (const o of overlapping) log('overlap_warning', { requestId: record.id, otherRequestId: o.id, otherRequester: o.requester.participantId });
      setTab('edit');
      void runLLM(record, 0);
    },
    [taskActive, selection, doc, me, activeRequests, resolved, log, runLLM, notify],
  );

  const actions: RequestActions = useMemo(
    () => ({
      accept: (id, force) => {
        const before = requests.find((r) => r.id === id);
        const res = acceptRequest(doc, id, me.participantId, { force: Boolean(force) });
        if (res.ok) {
          const r = res.record;
          const v = r.versions[r.activeVersion];
          log('accept', {
            requestId: id, versionIndex: r.activeVersion, versions: r.versions.length, conflictOverride: r.applied?.conflictOverride ?? false,
            changedInside: res.changedInside, changedOutside: res.changedOutside, selectionLength: r.applied?.beforeText.length ?? 0,
            suggestionLength: v?.text.length ?? 0, decisionMs: v ? Date.now() - v.createdAt : null,
          });
          if (force) log('conflict_resolved', { requestId: id, action: 'override' });
          if (force) log('conflict_override', { requestId: id });
        } else if (res.reason === 'conflict' || res.reason === 'deleted') {
          if (before?.status !== 'conflicted') log('conflict_detected', { requestId: id, kind: res.reason === 'deleted' ? 'deleted' : 'changed', via: 'accept' });
          notify(res.reason === 'deleted' ? 'The selected text was deleted, so the suggestion cannot be applied.' : 'The text changed since your request: nothing was applied. Review the conflict.');
        }
      },
      reject: (id) => {
        const before = requests.find((r) => r.id === id);
        const res = rejectRequest(doc, id, me.participantId);
        if (res.ok) {
          log('reject', { requestId: id, versions: before?.versions.length ?? 0, wasConflicted: before?.status === 'conflicted', wasGenerating: before?.status === 'generating' });
          if (before?.status === 'conflicted') log('conflict_resolved', { requestId: id, action: 'reject' });
        }
      },
      regenerate: (id, rebase) => {
        const before = requests.find((r) => r.id === id);
        try {
          const { record, variant } = beginRegeneration(doc, id, { rebase: Boolean(rebase) });
          log('regenerate', { requestId: id, variant, rebase: Boolean(rebase) });
          if (before?.status === 'conflicted') log('conflict_resolved', { requestId: id, action: 'regenerate' });
          void runLLM(record, variant);
        } catch (err) {
          notify(errorMessage(err).message);
        }
      },
      selectVersion: (id, index) => {
        selectVersion(doc, id, index);
      },
      focusRequest: (id) => {
        const range = resolved.get(id);
        if (!range) return;
        editorApi.current?.setSelection(range.from, range.to);
        editorApi.current?.focus();
      },
    }),
    [doc, me.participantId, requests, resolved, log, runLLM, notify],
  );

  const revert = useCallback(
    (id: string, force?: boolean) => {
      const r = requests.find((x) => x.id === id);
      const res = revertRequest(doc, id, me.participantId, { force: Boolean(force) });
      if (res.ok) {
        log('revert', { requestId: id, force: Boolean(force), requester: r?.requester.participantId ?? null });
        setRevertConflicts((c) => {
          const next = { ...c };
          delete next[id];
          return next;
        });
      } else if (res.reason === 'conflict' || res.reason === 'deleted') {
        setRevertConflicts((c) => ({ ...c, [id]: 'This AI text was edited after it was accepted; reverting would discard those edits.' }));
      }
    },
    [doc, me.participantId, requests, log],
  );

  const expand = useCallback(
    (unit: 'sentence' | 'paragraph') => {
      const sel = editorApi.current?.getSelection() ?? selection;
      const range = { from: Math.min(sel.from, sel.to), to: Math.max(sel.from, sel.to) };
      const next = unit === 'sentence' ? expandToSentences(text, range) : expandToParagraphs(text, range);
      editorApi.current?.setSelection(next.from, next.to);
      setSelection(next);
    },
    [selection, text],
  );

  const onSaveCommand = useCallback(
    (label: string, instruction: string) => {
      saveCommand(doc, { label, instruction, createdBy: me.name });
      log('command_saved', { label, instructionLength: instruction.length });
      notify(`Saved “${label}” to the team toolbar.`);
    },
    [doc, me.name, log, notify],
  );

  // ---------------------------------------------------------------- baseline chat
  const sendChat = useCallback(
    async (message: string) => {
      if (!taskActive) return;
      const document = parts.text.toString();
      const history = [...chat, { role: 'user' as const, content: message }];
      setChat(history);
      setChatBusy(true);
      log('chat_message', { typedChars: message.length, documentLength: document.length, turn: history.filter((m) => m.role === 'user').length });
      try {
        const res = await callLLM(
          {
            provider: settings.provider,
            model: settings.provider === 'openai' ? settings.model : undefined,
            request: { kind: 'chat', document, messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) },
          },
          settings.apiKey,
        );
        setChat((c) => [...c, { role: 'assistant', content: res.text, provider: res.provider }]);
        log('chat_response', {
          latencyMs: res.latencyMs, provider: res.provider, model: res.model, length: res.text.length,
          responseToDocumentRatio: document.length > 0 ? Math.round((res.text.length / document.length) * 100) / 100 : null,
        });
      } catch (err) {
        const { code, message: msg } = errorMessage(err);
        setChat((c) => [...c, { role: 'assistant', content: msg, error: true }]);
        log('chat_error', { code, message: msg });
      } finally {
        setChatBusy(false);
      }
    },
    [taskActive, parts.text, chat, log, settings.provider, settings.model, settings.apiKey],
  );

  const copyChat = useCallback(
    async (index: number) => {
      const m = chat[index];
      if (!m) return;
      const body = copyableText(m.content);
      const ok = await writeClipboard(body);
      if (ok) {
        setCopiedIndex(index);
        window.setTimeout(() => setCopiedIndex((c) => (c === index ? null : c)), 2000);
        log('copy_response', { length: body.length, messageIndex: index });
      } else {
        notify('Copy failed: select the text in the answer and press Ctrl/Cmd+C.');
      }
    },
    [chat, log, notify],
  );

  const onPaste = useCallback(
    (pasted: string, replaced: number) => {
      const t = pasted.trim();
      const fromAI = t.length > 0 && chat.some((m) => m.role === 'assistant' && !m.error && m.content.includes(t));
      log('paste', { length: pasted.length, replaced, fromAI });
    },
    [chat, log],
  );

  // ---------------------------------------------------------------- task flow
  const onStart = useCallback(() => {
    if (startTask(doc, me.participantId)) log('task_start', {});
  }, [doc, me.participantId, log]);

  const onFinish = useCallback(() => {
    const pending = activeRequests.filter((r) => r.status !== 'failed').length;
    const msg = pending > 0 ? `There are ${pending} AI suggestion(s) still open. Finish the task anyway?` : 'Finish the task for everyone in this session?';
    if (!window.confirm(msg)) return;
    const startedAt = meta?.taskStartedAt;
    if (endTask(doc, me.participantId)) log('task_end', { durationSec: startedAt !== undefined ? Math.round((Date.now() - startedAt) / 100) / 10 : null });
  }, [doc, me.participantId, log, meta, activeRequests]);

  const mySubmission = questionnaires.find((q) => q.participantId === me.participantId);
  const showQuestionnaire = isStudyTask && params.task !== 'practice' && ended && !mySubmission;

  const onSubmitQuestionnaire = useCallback(
    (likert: Record<string, number>, tlx: Record<string, number>, comment: string) => {
      const response: QuestionnaireResponse = {
        id: makeId('q'), participantId: me.participantId, name: me.name, role: me.role, condition: params.condition, task: params.task,
        submittedAt: Date.now(), likert, tlx, comment,
      };
      submitQuestionnaire(doc, response);
      const s = scoreQuestionnaire(likert, tlx);
      log('questionnaire_submit', { control: s.control, transparency: s.transparency, coordination: s.coordination, tlxRaw: s.tlxRaw });
    },
    [doc, me, params.condition, params.task, log],
  );

  const historyCount = requests.length;

  return (
    <div className="cdg-app" data-testid="workspace" data-condition={params.condition}>
      <header className="cdg-header">
        <div className="cdg-brand">
          <a href="#/collab" className="cdg-brand-link" title="Back to session setup">Collaborative DirectGPT</a>
          <span className={`cdg-condition cdg-condition-${params.condition}`} data-testid="condition-badge">
            {isDirect ? 'Direct manipulation' : 'Baseline: chat'}
          </span>
          <span className="cdg-muted cdg-small" data-testid="room-name">session {params.session} · {params.task}</span>
        </div>
        <PresenceBar states={presence} />
        <div className="cdg-header-right">
          <span className={`cdg-conn cdg-conn-${conn.status}`} data-testid="connection" title={`Sync server: ${conn.status}`}>
            ● {conn.status === 'connected' ? 'Live' : conn.status}
          </span>
          {isDirect && (
            <label className="cdg-small cdg-toggle" title="Underline text that came from accepted AI edits">
              <input type="checkbox" checked={showProvenance} onChange={(e) => setShowProvenance(e.target.checked)} /> AI provenance
            </label>
          )}
          <LLMSettings />
          <ExportMenu room={room} onExport={(format) => log('export', { format })} />
        </div>
      </header>
      {conn.status !== 'connected' && (
        <div className="cdg-banner" role="status">Connection to the sync server lost. Reconnecting… Your edits are kept and will sync when the connection returns.</div>
      )}
      {duplicatePid && (
        <div className="cdg-banner cdg-banner-warn" role="status" data-testid="duplicate-pid">
          Someone else in this session is also using participant ID “{me.participantId}”. Each person should join with their own ID so edits and data are attributed correctly.
        </div>
      )}
      <div className="cdg-main">
        <TaskPanel task={task} role={me.role} meta={meta} isStudyTask={isStudyTask} onStart={onStart} onFinish={onFinish} nameOf={nameOf} />
        <div className="cdg-doc">
          {!taskActive && isStudyTask && <div className="cdg-doc-overlay-note">{disabledReason}</div>}
          <Editor
            ref={editorApi}
            ytext={parts.text}
            awareness={awareness}
            undoManager={undoManager}
            marks={marks}
            readOnly={!taskActive}
            onSelectionChange={(from, to) => setSelection({ from, to })}
            onPaste={onPaste}
            onMarkClick={(id) => {
              setTab('edit');
              actions.focusRequest(id);
            }}
          />
        </div>
        <div className="cdg-side">
          {isDirect ? (
            <>
              <div className="cdg-tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'edit'} className={`cdg-tab ${tab === 'edit' ? 'active' : ''}`} onClick={() => setTab('edit')} data-testid="tab-edit">
                  AI edit {activeRequests.length > 0 ? `(${activeRequests.length})` : ''}
                </button>
                <button role="tab" aria-selected={tab === 'history'} className={`cdg-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')} data-testid="tab-history">
                  History ({historyCount})
                </button>
              </div>
              {tab === 'edit' ? (
                <DirectPanel
                  selection={selectionInfo}
                  enabled={taskActive}
                  disabledReason={disabledReason}
                  savedCommands={savedCommands}
                  activeRequests={activeRequests}
                  myId={me.participantId}
                  liveCheck={live}
                  actions={actions}
                  onCommand={requestEdit}
                  onExpand={expand}
                  onSaveCommand={onSaveCommand}
                />
              ) : (
                <HistoryPanel
                  requests={requests}
                  myId={me.participantId}
                  nameOf={nameOf}
                  onRevert={revert}
                  onFocus={actions.focusRequest}
                  revertConflicts={revertConflicts}
                  disabled={!taskActive}
                />
              )}
            </>
          ) : (
            <ChatPanel
              messages={chat}
              busy={chatBusy}
              enabled={taskActive}
              disabledReason={disabledReason}
              onSend={(m) => void sendChat(m)}
              onCopy={(i) => void copyChat(i)}
              copiedIndex={copiedIndex}
            />
          )}
        </div>
      </div>
      {ended && mySubmission && isStudyTask && (
        <div className="cdg-done" data-testid="task-done">
          Thank you! Your questionnaire was saved. The facilitator can now export the session data (⬇ Export data).
        </div>
      )}
      {toast && (
        <div className="cdg-toast" role="status" data-testid="toast">
          {toast}
        </div>
      )}
      {showQuestionnaire && <Questionnaire conditionLabel={CONDITION_LABELS[params.condition]} onSubmit={onSubmitQuestionnaire} />}
    </div>
  );
}
