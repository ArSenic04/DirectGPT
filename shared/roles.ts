/**
 * Study roles. Any number of people can join a session. A role only decides
 * which task items a person is asked to do:
 *
 * - `A` / `B`: the two partners of the formal pair study (each has items).
 * - `C`, `D`, …: extra editors. They have no assigned items, see every item
 *   and may help with any of them.
 * - `null`: no role (free editing, e.g. the Sandbox task).
 */
import type { TaskDefinition, TaskItem } from './tasks';

export type StudyRole = string;

/** Roles that own task items in the pair protocol. */
export const PAIR_ROLES: readonly StudyRole[] = ['A', 'B'];
/** Roles offered on the setup screen. */
export const ROLE_CHOICES: readonly StudyRole[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** A single upper-case letter, or null for "no role". */
export function parseRole(value: string | null | undefined): StudyRole | null {
  const v = (value ?? '').trim().toUpperCase();
  return /^[A-Z]$/.test(v) ? v : null;
}

export function isPairRole(role: StudyRole | null | undefined): boolean {
  return role !== null && role !== undefined && PAIR_ROLES.includes(role);
}

export function roleLabel(role: StudyRole | null | undefined): string {
  if (role === null || role === undefined) return 'Editor';
  return isPairRole(role) ? `Partner ${role}` : `Extra editor (${role})`;
}

export interface RoleItems {
  /** Items assigned to this role (empty for extra editors and no-role users). */
  mine: TaskItem[];
  /** Everybody else's items, grouped by role in A, B order. */
  others: Array<{ role: StudyRole; items: TaskItem[] }>;
}

export function itemsForRole(task: TaskDefinition, role: StudyRole | null | undefined): RoleItems {
  const mine = isPairRole(role) ? task.items.filter((i) => i.role === role) : [];
  const roles = Array.from(new Set(task.items.map((i) => i.role))).filter((r) => r !== role);
  return { mine, others: roles.map((r) => ({ role: r, items: task.items.filter((i) => i.role === r) })) };
}
