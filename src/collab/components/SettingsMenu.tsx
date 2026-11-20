/** LLM provider settings (MOCK or OpenAI-compatible) and export links. */
import { useState } from 'react';
import { useSettings } from '../settings';

export function LLMSettings() {
  const { provider, model, apiKey, serverConfig, setProvider, setModel, setApiKey } = useSettings();
  const [open, setOpen] = useState(false);
  const keyReady = provider === 'mock' || apiKey.trim().length > 0 || serverConfig?.serverKeyConfigured;
  return (
    <div className="cdg-menu">
      <button
        className={`cdg-llm-badge ${provider === 'mock' ? 'cdg-llm-mock' : ''} ${keyReady ? '' : 'cdg-llm-missing'}`}
        onClick={() => setOpen(!open)}
        data-testid="llm-badge"
        aria-expanded={open}
      >
        {provider === 'mock' ? 'MOCK LLM (no key)' : `OpenAI · ${model}`}
        {!keyReady && ' · key missing'}
      </button>
      {open && (
        <div className="cdg-popover" data-testid="llm-settings">
          <label className="cdg-field">
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value === 'openai' ? 'openai' : 'mock')} data-testid="provider-select">
              <option value="mock">MOCK (deterministic, for demos and tests)</option>
              <option value="openai">OpenAI-compatible API</option>
            </select>
          </label>
          {provider === 'openai' && (
            <>
              <label className="cdg-field">
                Model
                <input className="cdg-input" value={model} maxLength={100} onChange={(e) => setModel(e.target.value)} list="cdg-models" />
                <datalist id="cdg-models">
                  <option value="gpt-4o" />
                  <option value="gpt-4o-mini" />
                  <option value="gpt-4.1" />
                  <option value="gpt-4.1-mini" />
                </datalist>
              </label>
              <label className="cdg-field">
                API key {serverConfig?.serverKeyConfigured ? '(optional: the server has OPENAI_API_KEY)' : ''}
                <input
                  className="cdg-input"
                  type="password"
                  autoComplete="off"
                  placeholder={serverConfig?.serverKeyConfigured ? 'Using the server key' : 'sk-…'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  data-testid="api-key"
                />
              </label>
              <p className="cdg-small cdg-muted">
                The key stays in this tab's memory and is only sent to the local server, which forwards it to {serverConfig?.baseUrlHost ?? 'the provider'}. It is never stored or shared with collaborators.
              </p>
            </>
          )}
          {provider === 'mock' && (
            <p className="cdg-small cdg-muted">
              The MOCK provider applies deterministic text rules (no AI). Suggestions are labelled MOCK. Use it to demo and test; use a real model for the study.
            </p>
          )}
          <button className="cdg-btn cdg-btn-small" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}

export function ExportMenu({ room, onExport }: { room: string; onExport: (format: string) => void }) {
  const [open, setOpen] = useState(false);
  const formats: Array<[string, string]> = [
    ['json', 'Full session (JSON)'],
    ['events.csv', 'Event log (CSV)'],
    ['summary.csv', 'Measures per participant (CSV)'],
    ['questionnaires.csv', 'Questionnaires (CSV)'],
  ];
  return (
    <div className="cdg-menu">
      <button className="cdg-btn cdg-btn-small" onClick={() => setOpen(!open)} data-testid="export-button" aria-expanded={open}>
        ⬇ Export data
      </button>
      {open && (
        <div className="cdg-popover cdg-popover-right" data-testid="export-menu">
          {formats.map(([f, label]) => (
            <a
              key={f}
              className="cdg-menu-item"
              href={`/api/rooms/${encodeURIComponent(room)}/export?format=${f}&download=1`}
              download
              data-testid={`export-${f}`}
              onClick={() => onExport(f)}
            >
              {label}
            </a>
          ))}
          <div className="cdg-small cdg-muted cdg-pad">A copy of the JSON is also saved on the server in data/exports/.</div>
        </div>
      )}
    </div>
  );
}
