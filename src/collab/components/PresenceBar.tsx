/** Who is in the room and what they are doing (awareness). */
import type { PresenceState } from '../hooks';

const ACTIVITY: Record<string, string> = {
  idle: '',
  selecting: 'selecting text',
  waiting: 'waiting for the AI',
  reviewing: 'reviewing an AI suggestion',
  chatting: 'chatting with the AI',
  typing: 'typing',
};

export function PresenceBar({ states }: { states: PresenceState[] }) {
  return (
    <div className="cdg-presence" data-testid="presence">
      {states.map((s) => {
        const act = s.activity ? ACTIVITY[s.activity.kind] : '';
        return (
          <span
            key={s.clientId}
            className="cdg-presence-user"
            data-testid="presence-user"
            title={`${s.user.name} (${s.user.participantId}, partner ${s.user.role})${act ? ` — ${act}` : ''}`}
          >
            <span className="cdg-avatar" style={{ background: s.user.color }}>{s.user.name.charAt(0).toUpperCase()}</span>
            <span className="cdg-presence-name">
              {s.user.name}
              {s.isLocal ? ' (you)' : ''}
              {act && <span className="cdg-presence-act" data-testid="presence-activity"> · {act}{s.activity?.detail ? `: ${s.activity.detail}` : ''}</span>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
