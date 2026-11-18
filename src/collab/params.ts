/** Session parameters carried in the URL (#/collab?session=...&pid=...). */
import type { Condition, LLMProviderId } from '../../shared/types';
import { CONDITIONS } from '../../shared/types';
import { sanitizeId } from '../../shared/room';
import { findTask } from '../../shared/tasks';
import { parseRole } from '../../shared/roles';

export interface SessionParams {
  session: string;
  task: string;
  condition: Condition;
  pid: string;
  name: string;
  /** Optional study role (A, B, C, …); null = no role. */
  role: string | null;
  provider: LLMProviderId;
  model: string;
}

export const DEFAULT_MODEL = 'gpt-4o';

export function parseSessionParams(search: URLSearchParams): SessionParams | null {
  const session = sanitizeId(search.get('session') ?? '');
  const task = findTask(search.get('task') ?? '')?.id ?? '';
  const condition = search.get('condition') ?? '';
  const pid = sanitizeId(search.get('pid') ?? '');
  const name = (search.get('name') ?? '').trim().slice(0, 40);
  const role = findTask(task)?.items.length ? parseRole(search.get('role')) : null;
  const provider: LLMProviderId = search.get('provider') === 'openai' ? 'openai' : 'mock';
  const model = (search.get('model') ?? DEFAULT_MODEL).trim().slice(0, 100) || DEFAULT_MODEL;
  if (!session || !pid || !name || !findTask(task) || !(CONDITIONS as readonly string[]).includes(condition)) return null;
  return { session, task, condition: condition as Condition, pid, name, role, provider, model };
}

/** Query string of a join link. `role` is omitted when the participant has none. */
export function sessionSearch(p: SessionParams): string {
  const q = new URLSearchParams({ session: p.session, task: p.task, condition: p.condition, pid: p.pid, name: p.name });
  if (p.role) q.set('role', p.role);
  q.set('provider', p.provider);
  q.set('model', p.model);
  return q.toString();
}

/** Translucent version of a hex colour, for highlights. */
export function lighten(color: string, alpha = 0.22): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${color}${a}`;
}
