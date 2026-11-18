/** Session parameters carried in the URL (#/collab?session=...&pid=...). */
import type { Condition, LLMProviderId } from '../../shared/types';
import { CONDITIONS } from '../../shared/types';
import { sanitizeId } from '../../shared/room';
import { findTask } from '../../shared/tasks';

export interface SessionParams {
  session: string;
  task: string;
  condition: Condition;
  pid: string;
  name: string;
  role: 'A' | 'B';
  provider: LLMProviderId;
  model: string;
}

export const DEFAULT_MODEL = 'gpt-4o';

export function parseSessionParams(search: URLSearchParams): SessionParams | null {
  const session = sanitizeId(search.get('session') ?? '');
  const task = search.get('task') ?? '';
  const condition = search.get('condition') ?? '';
  const pid = sanitizeId(search.get('pid') ?? '');
  const name = (search.get('name') ?? '').trim().slice(0, 40);
  const role = search.get('role') === 'B' ? 'B' : 'A';
  const provider: LLMProviderId = search.get('provider') === 'openai' ? 'openai' : 'mock';
  const model = (search.get('model') ?? DEFAULT_MODEL).trim().slice(0, 100) || DEFAULT_MODEL;
  if (!session || !pid || !name || !findTask(task) || !(CONDITIONS as readonly string[]).includes(condition)) return null;
  return { session, task, condition: condition as Condition, pid, name, role, provider, model };
}

export function sessionSearch(p: SessionParams): string {
  const q = new URLSearchParams({
    session: p.session,
    task: p.task,
    condition: p.condition,
    pid: p.pid,
    name: p.name,
    role: p.role,
    provider: p.provider,
    model: p.model,
  });
  return q.toString();
}

const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2'];

export function colorFor(role: 'A' | 'B', pid: string): string {
  if (role === 'A') return PALETTE[0];
  if (role === 'B') return PALETTE[1];
  let h = 0;
  for (const ch of pid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Translucent version of a hex colour, for highlights. */
export function lighten(color: string, alpha = 0.22): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${color}${a}`;
}
