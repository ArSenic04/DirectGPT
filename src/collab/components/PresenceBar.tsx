/** Who is in the room and what they are doing (awareness). */
import type { PresenceState } from '../hooks';
import { roleLabel } from '../../../shared/roles';

const ACTIVITY: Record<string, string> = {
  idle: '',
  selecting: 'selecting text',
  waiting: 'waiting for the AI',
  reviewing: 'reviewing an AI suggestion',
  chatting: 'chatting with the AI',
  typing: 'typing',
};

/** With many collaborators, others are shown compactly (avatar + name, activity in the tooltip). */
const COMPACT_AFTER = 3;

export function PresenceBar({ states }: { states: PresenceState[] }) {
  const compact = states.length > COMPACT_AFTER;
  return (
    <div className={`cdg-presence ${compact ? 'cdg-presence-compact' : ''}`} data-testid="presence" data-count={states.length}>
      {compact && <span className="cdg-presence-count" data-testid="presence-count">{states.length} online</span>}
      {states.map((s) => {
        const act = s.activity ? ACTIVITY[s.activity.kind] : '';
        const showAct = act && (!compact || s.isLocal);
        return (
          <span
            key={s.clientId}
            className="cdg-presence-user"
            data-testid="presence-user"
            title={`${s.user.name} (${s.user.participantId}${s.user.role ? `, ${roleLabel(s.user.role)}` : ''})${act ? ` — ${act}` : ''}`}
            data-pid={s.user.participantId}
          >
            <span className={`cdg-avatar ${act ? 'cdg-avatar-busy' : ''}`} style={{ background: s.user.color }}>{s.user.name.charAt(0).toUpperCase()}</span>
            <span className="cdg-presence-name">
              {s.user.name}
              {s.isLocal ? ' (you)' : ''}
              {showAct && <span className="cdg-presence-act" data-testid="presence-activity"> · {act}{s.activity?.detail ? `: ${s.activity.detail}` : ''}</span>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
