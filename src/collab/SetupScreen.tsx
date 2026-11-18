/**
 * Session setup: session id, participant id, name, optional study role,
 * condition and task, plus the LLM provider. Any number of people can join
 * the same session; the invite link can be shared with all of them and each
 * joiner enters their own name and participant id. For the formal pair study
 * the screen also shows the counterbalanced order.
 */
import { useEffect, useMemo, useState } from 'react';
import { findTask, TASKS } from '../../shared/tasks';
import { parseRole, ROLE_CHOICES, roleLabel } from '../../shared/roles';
import { CONDITION_LABELS, type Condition } from '../../shared/types';
import { orderForPair, pairNumberFromSession } from '../../shared/counterbalance';
import { sanitizeId } from '../../shared/room';
import { DEFAULT_MODEL, sessionSearch, type SessionParams } from './params';
import { useSettings } from './settings';

function suggestPid(): string {
  return `u-${Math.random().toString(36).slice(2, 7)}`;
}

export function SetupScreen({ initial }: { initial: URLSearchParams }) {
  const settings = useSettings();
  const [session, setSession] = useState(initial.get('session') ?? 'pair01');
  // Every joiner gets their own participant id: suggest a fresh one unless the link carries one.
  const [pid, setPid] = useState(() => initial.get('pid') ?? suggestPid());
  const [name, setName] = useState(initial.get('name') ?? '');
  const [role, setRole] = useState<string>(parseRole(initial.get('role')) ?? '');
  const [condition, setCondition] = useState<Condition>(initial.get('condition') === 'baseline' ? 'baseline' : 'direct');
  const [task, setTask] = useState(findTask(initial.get('task') ?? '')?.id ?? 'practice');
  const [copiedPair, setCopiedPair] = useState(false);
  const hasRoles = (findTask(task)?.items.length ?? 0) > 0;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const p = initial.get('provider');
    if (p === 'openai' || p === 'mock') settings.setProvider(p);
    const m = initial.get('model');
    if (m) settings.setModel(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pair = pairNumberFromSession(session);
  const order = pair !== null ? orderForPair(pair) : null;
  const valid = sanitizeId(session).length > 0 && sanitizeId(pid).length > 0 && name.trim().length > 0;

  const params: SessionParams = {
    session: sanitizeId(session), task, condition, pid: sanitizeId(pid), name: name.trim(), role: hasRoles ? parseRole(role) : null,
    provider: settings.provider, model: settings.model || DEFAULT_MODEL,
  };
  // Invite link: session, task, condition and provider only; each joiner adds their own name and id.
  const inviteLink = useMemo(() => {
    const q = new URLSearchParams({ session: params.session, task, condition, provider: settings.provider, model: params.model });
    return `${window.location.origin}${window.location.pathname}#/collab?${q.toString()}`;
  }, [params.session, params.model, task, condition, settings.provider]);
  // Pair study: the other partner's link pre-selects the complementary role.
  const pairRole = role === 'A' ? 'B' : role === 'B' ? 'A' : null;
  const pairLink = pairRole ? `${inviteLink}&role=${pairRole}` : null;

  const copy = async (text: string, done: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      done(true);
    } catch {
      done(false);
    }
  };

  const join = () => {
    if (!valid) return;
    window.location.hash = `/collab?${sessionSearch(params)}`;
  };

  return (
    <div className="cdg-setup-page">
      <div className="cdg-setup" data-testid="setup">
        <h1>Collaborative DirectGPT</h1>
        <p className="cdg-muted">
          Direct manipulation for multi-user AI-assisted document editing. Built on{' '}
          <a href="https://github.com/m-damien/DirectGPT" target="_blank" rel="noreferrer">DirectGPT</a> (Masson et al., CHI 2024).
        </p>
        <div className="cdg-setup-grid">
          <label className="cdg-field">
            Session / pair ID
            <input className="cdg-input" value={session} onChange={(e) => setSession(e.target.value)} data-testid="setup-session" />
          </label>
          <label className="cdg-field">
            Participant ID
            <input className="cdg-input" value={pid} placeholder="P01" onChange={(e) => setPid(e.target.value)} data-testid="setup-pid" />
          </label>
          <label className="cdg-field">
            Display name
            <input className="cdg-input" value={name} placeholder="Alice" onChange={(e) => setName(e.target.value)} data-testid="setup-name" />
          </label>
          <label className="cdg-field">
            Study role {hasRoles ? '(optional)' : ''}
            <select value={hasRoles ? role : ''} disabled={!hasRoles} onChange={(e) => setRole(e.target.value)} data-testid="setup-role">
              <option value="">{hasRoles ? 'No role (sees all items)' : 'No roles in this task'}</option>
              {hasRoles && ROLE_CHOICES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
          <label className="cdg-field">
            Condition
            <select value={condition} onChange={(e) => setCondition(e.target.value === 'baseline' ? 'baseline' : 'direct')} data-testid="setup-condition">
              <option value="direct">{CONDITION_LABELS.direct}</option>
              <option value="baseline">{CONDITION_LABELS.baseline}</option>
            </select>
          </label>
          <label className="cdg-field">
            Task
            <select value={task} onChange={(e) => setTask(e.target.value)} data-testid="setup-task">
              {TASKS.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
          <label className="cdg-field">
            LLM provider
            <select value={settings.provider} onChange={(e) => settings.setProvider(e.target.value === 'openai' ? 'openai' : 'mock')} data-testid="setup-provider">
              <option value="mock">MOCK (deterministic, no key)</option>
              <option value="openai">OpenAI-compatible API</option>
            </select>
          </label>
          {settings.provider === 'openai' && (
            <>
              <label className="cdg-field">
                Model
                <input className="cdg-input" value={settings.model} onChange={(e) => settings.setModel(e.target.value)} />
              </label>
              <label className="cdg-field cdg-field-wide">
                API key {settings.serverConfig?.serverKeyConfigured ? '(optional, the server has OPENAI_API_KEY)' : '(kept in memory only)'}
                <input className="cdg-input" type="password" autoComplete="off" value={settings.apiKey} onChange={(e) => settings.setApiKey(e.target.value)} placeholder="sk-…" />
              </label>
            </>
          )}
        </div>
        {order && (
          <div className="cdg-order" data-testid="counterbalance">
            Counterbalanced order for pair {pair}: practice, then <strong>1)</strong> {CONDITION_LABELS[order[0].condition]} on {order[0].task}, then{' '}
            <strong>2)</strong> {CONDITION_LABELS[order[1].condition]} on {order[1].task}.
          </div>
        )}
        <div className="cdg-setup-actions">
          <button className="cdg-btn cdg-btn-primary" disabled={!valid} onClick={join} data-testid="setup-join">
            Join session
          </button>
          <button className="cdg-btn" onClick={() => void copy(inviteLink, setCopied)} data-testid="copy-invite">
            {copied ? 'Link copied ✓' : 'Copy link for partners (anyone)'}
          </button>
        </div>
        <div className="cdg-invite" data-testid="invite">
          <strong>Invite anyone:</strong> share this link with as many people as you like. Each person opens it, types their own name and participant
          ID, and joins the same document.
          <code className="cdg-code" data-testid="invite-link">{inviteLink}</code>
          {pairLink && (
            <div className="cdg-small" style={{ marginTop: 8 }}>
              Pair study: send your partner the link with <strong>role {pairRole}</strong> pre-selected{' '}
              <button className="cdg-btn cdg-btn-small" onClick={() => void copy(pairLink, setCopiedPair)} data-testid="copy-pair-link">
                {copiedPair ? 'Copied ✓' : `Copy partner ${pairRole} link`}
              </button>
            </div>
          )}
        </div>
        <p className="cdg-small cdg-muted">
          Quick demo: open the invite link in several browser windows (or on other computers on the same network), give each window a different name,
          and use the “Sandbox” task. Study roles only matter for the pair-study tasks: A and B have their own items, C and later letters are extra editors.
        </p>
        <p className="cdg-small"><a href="#/">← Original DirectGPT launcher</a></p>
      </div>
    </div>
  );
}
