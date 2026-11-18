/**
 * Session setup (study support): session/pair id, participant id, name,
 * partner role, condition and task, plus the LLM provider. Produces the URL
 * that both partners open; shows the counterbalanced order for the pair.
 */
import { useEffect, useMemo, useState } from 'react';
import { TASKS } from '../../shared/tasks';
import { CONDITION_LABELS, type Condition } from '../../shared/types';
import { orderForPair, pairNumberFromSession } from '../../shared/counterbalance';
import { sanitizeId } from '../../shared/room';
import { DEFAULT_MODEL, sessionSearch, type SessionParams } from './params';
import { useSettings } from './settings';

export function SetupScreen({ initial }: { initial: URLSearchParams }) {
  const settings = useSettings();
  const [session, setSession] = useState(initial.get('session') ?? 'pair01');
  const [pid, setPid] = useState(initial.get('pid') ?? '');
  const [name, setName] = useState(initial.get('name') ?? '');
  const [role, setRole] = useState<'A' | 'B'>(initial.get('role') === 'B' ? 'B' : 'A');
  const [condition, setCondition] = useState<Condition>(initial.get('condition') === 'baseline' ? 'baseline' : 'direct');
  const [task, setTask] = useState(initial.get('task') ?? 'practice');
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
    session: sanitizeId(session), task, condition, pid: sanitizeId(pid), name: name.trim(), role,
    provider: settings.provider, model: settings.model || DEFAULT_MODEL,
  };
  const partnerLink = useMemo(() => {
    const q = new URLSearchParams({ session: params.session, task, condition, role: role === 'A' ? 'B' : 'A', provider: settings.provider, model: params.model });
    return `${window.location.origin}${window.location.pathname}#/collab?${q.toString()}`;
  }, [params.session, params.model, task, condition, role, settings.provider]);

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
            Partner role
            <select value={role} onChange={(e) => setRole(e.target.value === 'B' ? 'B' : 'A')} data-testid="setup-role">
              <option value="A">Partner A</option>
              <option value="B">Partner B</option>
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
          <button
            className="cdg-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(partnerLink);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Link copied ✓' : 'Copy link for partner'}
          </button>
        </div>
        <p className="cdg-small cdg-muted">
          Partner link (role {role === 'A' ? 'B' : 'A'}): <code className="cdg-code">{partnerLink}</code>
        </p>
        <p className="cdg-small cdg-muted">
          Quick demo: open this page in two browser windows, use the same session ID and the “Sandbox” task, and give each window a different name.
        </p>
        <p className="cdg-small"><a href="#/">← Original DirectGPT launcher</a></p>
      </div>
    </div>
  );
}
