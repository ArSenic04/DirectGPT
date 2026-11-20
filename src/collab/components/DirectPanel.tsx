/**
 * Direct-manipulation AI panel (Figure 1, steps 2–3): the current selection
 * and its scope, the command toolbar (built-in + team commands saved by
 * collaborators), a custom instruction box, and the suggestion cards.
 */
import { useState } from 'react';
import type { AIRequestRecord, SavedCommand, ScopeKind } from '../../../shared/types';
import { BUILTIN_COMMANDS, TONES, toneCommand, type CommandDefinition } from '../../../shared/commands';
import type { AnchorCheck } from '../../../shared/anchors';
import { PreviewCard, type RequestActions } from './PreviewCard';
import { MAX_INSTRUCTION_CHARS } from '../../../shared/prompts';

export interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  scope: ScopeKind;
  overlaps: string[];
}

interface Props {
  selection: SelectionInfo | null;
  enabled: boolean;
  disabledReason: string | null;
  savedCommands: SavedCommand[];
  activeRequests: AIRequestRecord[];
  myId: string;
  liveCheck: (r: AIRequestRecord) => AnchorCheck | null;
  actions: RequestActions;
  onCommand: (command: CommandDefinition, typedChars: number) => void;
  onExpand: (unit: 'sentence' | 'paragraph') => void;
  onSaveCommand: (label: string, instruction: string) => void;
}

export function DirectPanel(props: Props) {
  const { selection, enabled, savedCommands, activeRequests, myId } = props;
  const [custom, setCustom] = useState('');
  const canAsk = enabled && selection !== null && selection.to > selection.from;
  const mine = activeRequests.filter((r) => r.requester.participantId === myId);
  const others = activeRequests.filter((r) => r.requester.participantId !== myId);

  const submitCustom = () => {
    const instruction = custom.trim();
    if (!instruction || !canAsk) return;
    props.onCommand({ id: 'custom', label: 'Custom instruction', hint: '', instruction }, instruction.length);
    setCustom('');
  };

  return (
    <div className="cdg-direct" data-testid="direct-panel">
      <section className="cdg-section">
        <div className="cdg-section-title">1 · Select text in the document</div>
        {selection && selection.to > selection.from ? (
          <div className="cdg-selection" data-testid="selection-info">
            <div className="cdg-selection-text">“{selection.text.length > 160 ? `${selection.text.slice(0, 160)}…` : selection.text}”</div>
            <div className="cdg-selection-meta">
              <span className="cdg-chip" data-testid="selection-scope">{selection.scope}</span>
              <span className="cdg-muted">{selection.text.length} characters</span>
              <span className="cdg-spacer" />
              <button className="cdg-btn cdg-btn-ghost cdg-btn-small" onClick={() => props.onExpand('sentence')} disabled={!enabled}>Sentence</button>
              <button className="cdg-btn cdg-btn-ghost cdg-btn-small" onClick={() => props.onExpand('paragraph')} disabled={!enabled}>Paragraph</button>
            </div>
            {selection.overlaps.length > 0 && (
              <div className="cdg-warning" data-testid="overlap-warning">
                Heads-up: this overlaps a pending AI request by {selection.overlaps.join(', ')}. If both are accepted, the second one will be flagged as a conflict.
              </div>
            )}
          </div>
        ) : (
          <div className="cdg-empty">Select a sentence, paragraph or any span. Only the selected text can be changed by the AI.</div>
        )}
      </section>

      <section className="cdg-section">
        <div className="cdg-section-title">2 · Choose what the AI should do</div>
        {props.disabledReason && <div className="cdg-muted cdg-small">{props.disabledReason}</div>}
        <div className="cdg-toolbar" role="toolbar" aria-label="AI commands">
          {BUILTIN_COMMANDS.map((c) => (
            <button key={c.id} className="cdg-cmd" title={c.hint} disabled={!canAsk} data-testid={`cmd-${c.id}`} onClick={() => props.onCommand(c, 0)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="cdg-toolbar cdg-tone" role="group" aria-label="Change tone">
          <span className="cdg-muted cdg-small">Change tone:</span>
          {TONES.map((t) => (
            <button key={t} className="cdg-cmd" disabled={!canAsk} data-testid={`cmd-tone-${t}`} onClick={() => props.onCommand(toneCommand(t), 0)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {savedCommands.length > 0 && (
          <div className="cdg-toolbar" role="toolbar" aria-label="Team commands">
            <span className="cdg-muted cdg-small">Team commands:</span>
            {savedCommands.map((c) => (
              <button
                key={c.id}
                className="cdg-cmd cdg-cmd-saved"
                title={`${c.instruction} (saved by ${c.createdBy})`}
                disabled={!canAsk}
                data-testid="saved-command"
                onClick={() => props.onCommand({ id: `saved:${c.id}`, label: c.label, hint: c.instruction, instruction: c.instruction }, 0)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <div className="cdg-custom">
          <input
            className="cdg-input"
            placeholder="Or type an instruction, e.g. “make this more persuasive”"
            aria-label="Custom AI instruction"
            value={custom}
            maxLength={MAX_INSTRUCTION_CHARS}
            disabled={!enabled}
            data-testid="custom-instruction"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              // Ignore the Enter that confirms an input-method (IME) composition.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitCustom();
            }}
          />
          <button className="cdg-btn cdg-btn-primary" disabled={!canAsk || !custom.trim()} data-testid="ask-ai" onClick={submitCustom}>
            Ask AI
          </button>
          <button
            className="cdg-btn"
            disabled={!enabled || !custom.trim()}
            title="Save this instruction as a button for the whole team"
            data-testid="save-command"
            onClick={() => {
              const instruction = custom.trim();
              const label = instruction.length > 24 ? `${instruction.slice(0, 22)}…` : instruction;
              props.onSaveCommand(label, instruction);
            }}
          >
            ☆ Save
          </button>
        </div>
      </section>

      <section className="cdg-section cdg-section-grow">
        <div className="cdg-section-title">3 · Review suggestions</div>
        {activeRequests.length === 0 && <div className="cdg-empty">Suggestions appear here before anything changes in the shared document.</div>}
        {[...mine, ...others].map((r) => (
          <PreviewCard
            key={r.id}
            record={r}
            live={props.liveCheck(r)}
            isMine={r.requester.participantId === myId}
            actions={props.actions}
            disabled={!enabled}
          />
        ))}
      </section>
    </div>
  );
}
