/** Task instructions for this partner, task start/finish and timer. */
import { useEffect, useState } from 'react';
import type { TaskDefinition } from '../../../shared/tasks';
import type { SessionMeta } from '../../../shared/types';

interface Props {
  task: TaskDefinition;
  role: 'A' | 'B';
  meta: SessionMeta | null;
  isStudyTask: boolean;
  onStart: () => void;
  onFinish: () => void;
  nameOf: (participantId: string) => string;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TaskPanel({ task, role, meta, isStudyTask, onStart, onFinish, nameOf }: Props) {
  const started = meta?.taskStartedAt !== undefined;
  const ended = meta?.taskEndedAt !== undefined;
  const now = useNow(started && !ended);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const mine = task.items.filter((i) => i.role === role);
  const partner = task.items.filter((i) => i.role !== role);
  const elapsed = started ? (ended ? meta!.taskEndedAt! : now) - meta!.taskStartedAt! : 0;

  return (
    <aside className="cdg-task" data-testid="task-panel">
      <h2 className="cdg-task-title">{task.title}</h2>
      <p className="cdg-muted cdg-small">{task.description}</p>
      {isStudyTask && (
        <div className="cdg-task-controls">
          {!started && (
            <button className="cdg-btn cdg-btn-primary cdg-btn-block" data-testid="start-task" onClick={onStart}>
              ▶ Start task
            </button>
          )}
          {started && (
            <div className="cdg-timer" data-testid="task-timer">
              ⏱ {mmss(elapsed)} {ended ? '(finished)' : ''}
            </div>
          )}
          {started && !ended && (
            <button className="cdg-btn cdg-btn-block" data-testid="finish-task" onClick={onFinish}>
              ■ Finish task (both partners done)
            </button>
          )}
          {started && meta?.taskStartedBy && <div className="cdg-muted cdg-small">Started by {nameOf(meta.taskStartedBy)}{ended && meta.taskEndedBy ? `, finished by ${nameOf(meta.taskEndedBy)}` : ''}.</div>}
        </div>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="cdg-task-sub">Your items (partner {role})</h3>
          <ol className="cdg-task-items" data-testid="my-items">
            {mine.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={checked[i.id] ?? false} onChange={(e) => setChecked({ ...checked, [i.id]: e.target.checked })} />{' '}
                  {i.instruction}
                </label>
              </li>
            ))}
          </ol>
          <h3 className="cdg-task-sub">Your partner's items</h3>
          <ul className="cdg-task-items cdg-muted">
            {partner.map((i) => (
              <li key={i.id}>{i.instruction}</li>
            ))}
          </ul>
        </>
      )}
      {task.items.length === 0 && <p className="cdg-small">Free exploration: try selecting text and using the AI commands with a collaborator.</p>}
    </aside>
  );
}
